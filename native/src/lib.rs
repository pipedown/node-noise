#[macro_use]
extern crate neon;
extern crate noise_search;
extern crate unix_socket;
#[macro_use]
extern crate lazy_static;


use std::str;
use std::panic;
use std::thread;
use std::io::{BufReader, BufRead, Write};
use std::error::Error;
use std::collections::HashMap;
use std::vec::Vec;
use std::sync::Mutex;
use std::ops::DerefMut;
use std::fs;

use unix_socket::{UnixStream, UnixListener};

use neon::vm::{Call, JsResult};
use neon::js::{JsString, JsNumber, JsBoolean, JsNull, JsArray, JsObject,
    JsUndefined, Object, Value, JsValue};
use neon::js::error::{JsError, Kind};
use neon::mem::Handle;

use noise_search::index::{Index, OpenOptions};
use noise_search::query::{Query};
use noise_search::json_value::JsonValue;

enum Message {
    OpenIndex(String, Option<OpenOptions>),
    DropIndex(String),
    Add(Vec<String>),
    Delete(Vec<String>),
    Query(String),
    Close,
    ResponseOk(JsonValue),
    ResponseError(String),
}

// this is a global that provides a messaging slot from node clients to send messages
// to the server threads.
lazy_static! {
    static ref MESSAGE_MAP: Mutex<HashMap<u64, Option<Message>>> =
        Mutex::new(HashMap::new());
}

// This lock only allows one index to be updated at a time.
lazy_static! {
    static ref WRITE_LOCK: Mutex<()> = Mutex::new(());
}

fn js_start_listener(_call: Call) -> JsResult<JsUndefined> {
    let _ = fs::remove_file("echo.sock");
    let listener = UnixListener::bind("echo.sock").unwrap();

    thread::spawn(move || {
        // accept connections and process them, spawning a new thread for each one
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    /* connection succeeded */
                    thread::spawn(move || handle_client_outer(stream));
                }
                Err(msg) => {
                    /* connection failed */
                    println!("Error connecting socket: {}", msg);
                    break;
                }
            }
        }
    });

    Ok(JsUndefined::new())
}

fn js_open_index(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let name: Handle<JsString> = call.arguments.require(scope, 1)?.check::<JsString>()?;
    let create: Handle<JsBoolean> = call.arguments.require(scope, 2)?.check::<JsBoolean>()?;
    let options = if create.value() {Some(OpenOptions::Create)} else {None};
    let message = Message::OpenIndex(name.value(), options);

    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(message));

    Ok(JsUndefined::new())
}

fn js_drop_index(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let name: Handle<JsString> = call.arguments.require(scope, 1)?.check::<JsString>()?;
    let message = Message::DropIndex(name.value());

    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(message));

    Ok(JsUndefined::new())
}

fn js_index_add(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let array: Handle<JsArray> = call.arguments.require(scope, 1)?.check::<JsArray>()?;
    let node_vec = array.to_vec(scope)?;
    let mut noise_vec = Vec::with_capacity(node_vec.len());
    for val in node_vec.iter() {
        noise_vec.push(val.check::<JsString>()?.value());
    }
    let message = Message::Add(noise_vec);
    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(message));

    Ok(JsUndefined::new())
}

fn js_index_delete(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let array: Handle<JsArray> = call.arguments.require(scope, 1)?.check::<JsArray>()?;
    let node_vec = array.to_vec(scope)?;
    let mut noise_vec = Vec::with_capacity(node_vec.len());
    for val in node_vec.iter() {
        noise_vec.push(val.check::<JsString>()?.value());
    }
    let message = Message::Delete(noise_vec);
    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(message));

    Ok(JsUndefined::new())
}

fn js_index_query(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let query: Handle<JsString> = call.arguments.require(scope, 1)?.check::<JsString>()?;
    let message = Message::Query(query.value());
    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(message));

    Ok(JsUndefined::new())

}

fn js_index_close(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsString> = call.arguments.require(scope, 0)?.check::<JsString>()?;
    let connection_id: u64 = conn_id.value().parse().unwrap();
    MESSAGE_MAP.lock().unwrap().deref_mut().insert(connection_id, Some(Message::Close));

    Ok(JsUndefined::new())

}

fn js_get_response(mut call: Call) -> JsResult<JsValue> {
    let conn_id: Handle<JsString> = call.arguments.require(call.scope, 0)?.check::<JsString>()?;
    let connection_id: u64 = conn_id.value().parse().unwrap();
    let res = match MESSAGE_MAP.lock().unwrap().deref_mut().get_mut(&connection_id) {
        Some(ref mut res) => res.take(),
        None => return JsError::throw(Kind::Error, "missing response"),
    };
    match res.unwrap() {
        Message::ResponseOk(json) => {
            Ok(convert_json(&mut call, json))
        },
        Message::ResponseError(msg) => {
            JsError::throw(Kind::Error, &msg)
        },
        _ => panic!("Non-response message"),
    }
}

fn convert_json<'a>(mut call: &mut Call<'a>, json_in: JsonValue) -> Handle<'a, JsValue> {
    match json_in {
        JsonValue::Number(n) => JsNumber::new(call.scope, n).as_value(call.scope),
        JsonValue::String(s) => JsString::new(call.scope, &s).unwrap().as_value(call.scope),
        JsonValue::True => JsBoolean::new(call.scope, true).as_value(call.scope),
        JsonValue::False => JsBoolean::new(call.scope, false).as_value(call.scope),
        JsonValue::Null => JsNull::new().as_value(call.scope),
        JsonValue::Object(vec) => {
            let obj: Handle<JsObject> = JsObject::new(call.scope);
            for (key, value) in vec {
                assert!(obj.set(&key as &str, convert_json(call, value)).is_ok());
            }
            obj.as_value(call.scope)
        },
        JsonValue::Array(vec) => {
            let array = JsArray::new(call.scope, vec.len() as u32);
            for (n, value) in vec.into_iter().enumerate() {
                assert!(array.set(n as u32, convert_json(call, value)).is_ok());
            }
            array.as_value(call.scope)
        },
    }
}

fn handle_client_outer(stream: UnixStream) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();

    // first get our connection_id through the pipe.
    let connection_id = match reader.read_until(b';',&mut buf) {
        Ok(_size) => {
            buf.pop(); // remove trailing ';'
            str::from_utf8(&buf).unwrap().parse::<u64>().unwrap()
        },
        Err(msg) => {
            println!("Error reading socket: {}", msg);
            return;
        },
    };

    let _result = panic::catch_unwind(|| {
        handle_client(reader, connection_id);
    });
    
    {
        // clean up message slot
        MESSAGE_MAP.lock().unwrap().deref_mut().remove(&connection_id);
    }
}

fn handle_client(mut reader: BufReader<UnixStream>, connection_id: u64) {
    let mut buf = Vec::new();
    let mut index = Index::new();
    loop {
        // from now on the stream only sends a single byte on value 0
        // to indicate there is a message waiting,
        match reader.read_until(b'0', &mut buf) {
            Ok(0) => break,
            Ok(1) => {
                // first get the message
                let msg = {
                    MESSAGE_MAP.lock().unwrap().deref_mut()
                        .get_mut(&connection_id).unwrap().take().unwrap()
                };

                if let Message::Close = msg {
                    index = Index::new(); // this closes the existing instance
                    
                    // appease compiler: "value assigned to `index` is never read,"
                    assert!(!index.is_open()); 

                    break; // now we end the loop. The client will notice the socket close.
                }
                // process the message
                let response = process_message(&mut index, msg);

                // put the response in the queue
                {
                    *MESSAGE_MAP.lock().unwrap().deref_mut()
                        .get_mut(&connection_id).unwrap() = Some(response);
                }

                // notify the client the response is ready
                let mut writer = reader.get_mut();
                writer.write_all(&[b'1']).unwrap();
                writer.flush().unwrap();
                
            },
            Ok(_size) => panic!("WTF, more than one byte read!"),
            Err(msg) => println!("Error reading socket: {}", msg)
        }
    }
}

fn process_message(mut index: &mut Index, message: Message) -> Message {
    match message {
        Message::OpenIndex(name, options) => {
            match index.open(&name, options) {
                Ok(()) => Message::ResponseOk(JsonValue::True),
                Err(msg) => Message::ResponseError(msg.description().to_string()),
            }
        },
        Message::DropIndex(name) => {
            match Index::drop(&name) {
                Ok(()) => Message::ResponseOk(JsonValue::True),
                Err(msg) => Message::ResponseError(msg.description().to_string()),
            }
        },
        Message::Add(vec) => {
            let _guard = match WRITE_LOCK.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let mut results = Vec::with_capacity(vec.len());
            for doc_str in vec {
                match index.add(&doc_str) {
                    Ok(id) => results.push(JsonValue::String(id)),
                    Err(reason) => {
                        let err_str = JsonValue::String(reason.description().to_string());
                        let err_obj = vec![("error".to_string(), err_str)];
                        results.push(JsonValue::Object(err_obj))
                    },
                }
            }
            match index.flush() {
                Ok(()) => Message::ResponseOk(JsonValue::Array(results)),
                Err(reason) => {
                    Message::ResponseError(reason.description().to_string())
                },
            }
        },
        Message::Delete(vec) => {
            let _guard = match WRITE_LOCK.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            let mut results = Vec::with_capacity(vec.len());
            for doc_str in vec {
                match index.delete(&doc_str) {
                    Ok(true) => results.push(JsonValue::True),
                    Ok(false) => results.push(JsonValue::False),
                    Err(reason) => {
                        let err_str = JsonValue::String(reason.description().to_string());
                        let err_obj = vec![("error".to_string(), err_str)];
                        results.push(JsonValue::Object(err_obj))
                    },
                }
            }
            match index.flush() {
                Ok(()) => Message::ResponseOk(JsonValue::Array(results)),
                Err(reason) => {
                    Message::ResponseError(reason.description().to_string())
                },
            }
        },
        Message::Query(query) => {
            match Query::get_matches(&query, &index) {
                Ok(results) => Message::ResponseOk(JsonValue::Array(results.collect())),
                Err(reason) => Message::ResponseError(reason.description().to_string()),
            }
        },
        Message::Close => {
            panic!("Can't get close message here!");
        },
        Message::ResponseOk(_json) => {
            panic!("Got ResponseOk on wrong side!");
        },
        Message::ResponseError(_string) => {
            panic!("Got ResponseError on wrong side!");
        }
    }
}

register_module!(m, {
    m.export("startListener", js_start_listener)?;
    m.export("openIndex", js_open_index)?;
    m.export("dropIndex", js_drop_index)?;
    m.export("indexAdd", js_index_add)?;
    m.export("indexDelete", js_index_delete)?;
    m.export("indexQuery", js_index_query)?;
    m.export("indexClose", js_index_close)?;
    m.export("getResponse", js_get_response)
});

