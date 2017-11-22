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
use std::ops::DerefMut;
use std::fs;
use std::sync::{Arc, Mutex};
use std::ops::Deref;
use std::mem::drop;

use unix_socket::{UnixStream, UnixListener};

use neon::vm::{Call, JsResult};
use neon::js::{JsString, JsNumber, JsBoolean, JsNull, JsArray, JsObject, JsUndefined, Object,
               Value, JsValue};
use neon::js::error::{JsError, Kind};
use neon::mem::Handle;

use noise_search::index::{Index, OpenOptions, Batch, MvccRwLock};
use noise_search::json_value::JsonValue;

enum Message {
    OpenIndex(String, Option<OpenOptions>),
    DropIndex(String),
    Add(Vec<String>),
    Delete(Vec<String>),
    Query(String, Option<String>),
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

struct OpenedIndex {
    index: Index,
    open_count: usize,
}

struct OpenedIndexCleanupGuard {
    index: Arc<MvccRwLock<OpenedIndex>>,
}

impl Drop for OpenedIndexCleanupGuard {
    fn drop(&mut self) {
        let opt_name = {
            let mut rw_guard = match self.index.write() {
                Ok(rw_guard) => rw_guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            rw_guard.open_count -= 1;
            if rw_guard.open_count == 0 {
                Some(rw_guard.index.get_name().to_string())
            } else {
                None
            }
        };
        if opt_name.is_some() {
            let mut guard = match OPEN_INSTANCES.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.deref_mut().remove(&opt_name.unwrap());
        }
    }
}

impl Deref for OpenedIndexCleanupGuard {
    type Target = Arc<MvccRwLock<OpenedIndex>>;

    fn deref(&self) -> &Arc<MvccRwLock<OpenedIndex>> {
        &self.index
    }
}

impl DerefMut for OpenedIndexCleanupGuard {
    fn deref_mut(&mut self) -> &mut Arc<MvccRwLock<OpenedIndex>> {
        &mut self.index
    }
}

// This lock only allows one index to be updated at a time.
lazy_static! {
    static ref OPEN_INSTANCES: Mutex<HashMap<String, Arc<MvccRwLock<OpenedIndex>>>> = Mutex::new(HashMap::new());
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

fn js_send_message(call: Call) -> JsResult<JsUndefined> {
    let scope = call.scope;
    let conn_id: Handle<JsNumber> = call.arguments
        .require(scope, 0)?
        .check::<JsNumber>()?;
    let msg_type: Handle<JsNumber> = call.arguments
        .require(scope, 1)?
        .check::<JsNumber>()?;
    let args: Handle<JsArray> = call.arguments.require(scope, 2)?.check::<JsArray>()?;

    let vec = args.to_vec(scope)?;
    let message = match msg_type.value() as u64 {
        0 => {
            // open index
            let name = vec[0].check::<JsString>()?.value();
            let opt_create = if vec[1].check::<JsBoolean>()?.value() {
                Some(OpenOptions::Create)
            } else {
                None
            };
            Message::OpenIndex(name, opt_create)
        }
        1 => {
            // drop index
            Message::DropIndex(vec[0].check::<JsString>()?.value())
        }
        2 => {
            // add documents
            Message::Add(vec.iter()
                             .map(|val| val.check::<JsString>().unwrap().value())
                             .collect())
        }
        3 => {
            // delete documents
            Message::Delete(vec.iter()
                                .map(|val| val.check::<JsString>().unwrap().value())
                                .collect())
        }
        4 => {
            // query
            let params = if vec.len() == 2 {
                Some(vec[1].check::<JsString>()?.value())
            } else {
                None
            };
            Message::Query(vec[0].check::<JsString>()?.value(), params)
        }
        5 => Message::Close,
        _ => {
            return JsError::throw(Kind::Error, "unknown message type");
        }
    };

    MESSAGE_MAP
        .lock()
        .unwrap()
        .deref_mut()
        .insert(conn_id.value() as u64, Some(message));

    Ok(JsUndefined::new())
}

fn js_get_response(mut call: Call) -> JsResult<JsValue> {
    let conn_id = call.arguments
        .require(call.scope, 0)?
        .check::<JsNumber>()?
        .value() as u64;
    let res = match MESSAGE_MAP
              .lock()
              .unwrap()
              .deref_mut()
              .get_mut(&conn_id) {
        Some(ref mut res) => res.take(),
        None => return JsError::throw(Kind::Error, "missing response"),
    };
    match res.unwrap() {
        Message::ResponseOk(json) => Ok(convert_json(&mut call, json)),
        Message::ResponseError(msg) => JsError::throw(Kind::Error, &msg),
        _ => panic!("Non-response message"),
    }
}

fn js_get_error(mut call: Call) -> JsResult<JsUndefined> {
    let conn_id = call.arguments
        .require(call.scope, 0)?
        .check::<JsNumber>()?
        .value() as u64;
    let res = match MESSAGE_MAP
              .lock()
              .unwrap()
              .deref_mut()
              .get_mut(&conn_id) {
        Some(ref mut res) => res.take(),
        None => return JsError::throw(Kind::Error, "missing response"),
    };
    match res.unwrap() {
        Message::ResponseOk(json) => {
            //put back
            *MESSAGE_MAP
                 .lock()
                 .unwrap()
                 .deref_mut()
                 .get_mut(&conn_id)
                 .unwrap() = Some(Message::ResponseOk(json));
            Ok(JsUndefined::new())
        }
        Message::ResponseError(msg) => JsError::throw(Kind::Error, &msg),
        _ => panic!("Non-response message"),
    }
}

fn js_query_next(mut call: Call) -> JsResult<JsValue> {
    let conn_id = call.arguments
        .require(call.scope, 0)?
        .check::<JsNumber>()?
        .value() as u64;
    let res = match MESSAGE_MAP
              .lock()
              .unwrap()
              .deref_mut()
              .get_mut(&conn_id) {
        Some(ref mut res) => res.take(),
        None => return JsError::throw(Kind::Error, "missing response"),
    };
    match res.unwrap() {
        Message::ResponseOk(JsonValue::Array(mut vec)) => {
            if let Some(ret) = vec.pop() {
                let next = convert_json(&mut call, ret);
                let obj: Handle<JsObject> = JsObject::new(call.scope);
                let done = JsBoolean::new(call.scope, false).as_value(call.scope);
                assert!(obj.set("value", next).is_ok());
                assert!(obj.set("done", done).is_ok());
                // put the remaining vec back
                *MESSAGE_MAP
                     .lock()
                     .unwrap()
                     .deref_mut()
                     .get_mut(&conn_id)
                     .unwrap() = Some(Message::ResponseOk(JsonValue::Array(vec)));

                Ok(obj.as_value(call.scope))
            } else {
                let obj: Handle<JsObject> = JsObject::new(call.scope);
                let done = JsBoolean::new(call.scope, true).as_value(call.scope);
                assert!(obj.set("done", done).is_ok());
                Ok(obj.as_value(call.scope))
            }
        }
        Message::ResponseOk(_json) => panic!("Non-array message"),
        Message::ResponseError(msg) => JsError::throw(Kind::Error, &msg),
        _ => panic!("Non-response message"),
    }
}

fn js_query_unref(mut call: Call) -> JsResult<JsUndefined> {
    let conn_id = call.arguments
        .require(call.scope, 0)?
        .check::<JsNumber>()?
        .value() as u64;
    match MESSAGE_MAP
              .lock()
              .unwrap()
              .deref_mut()
              .get_mut(&conn_id) {
        Some(ref mut res) => {
            let _ = res.take();
            ()
        }
        None => (),
    }
    Ok(JsUndefined::new())
}

fn convert_json<'a>(mut call: &mut Call<'a>, json_in: JsonValue) -> Handle<'a, JsValue> {
    match json_in {
        JsonValue::Number(n) => JsNumber::new(call.scope, n).as_value(call.scope),
        JsonValue::String(s) => {
            JsString::new(call.scope, &s)
                .unwrap()
                .as_value(call.scope)
        }
        JsonValue::True => JsBoolean::new(call.scope, true).as_value(call.scope),
        JsonValue::False => JsBoolean::new(call.scope, false).as_value(call.scope),
        JsonValue::Null => JsNull::new().as_value(call.scope),
        JsonValue::Object(vec) => {
            let obj: Handle<JsObject> = JsObject::new(call.scope);
            for (key, value) in vec {
                assert!(obj.set(&key as &str, convert_json(call, value)).is_ok());
            }
            obj.as_value(call.scope)
        }
        JsonValue::Array(vec) => {
            let array = JsArray::new(call.scope, vec.len() as u32);
            for (n, value) in vec.into_iter().enumerate() {
                assert!(array.set(n as u32, convert_json(call, value)).is_ok());
            }
            array.as_value(call.scope)
        }
    }
}

fn handle_client_outer(stream: UnixStream) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();

    // first get our connection_id through the pipe.
    let connection_id = match reader.read_until(b';', &mut buf) {
        Ok(_size) => {
            buf.pop(); // remove trailing ';'
            str::from_utf8(&buf).unwrap().parse::<u64>().unwrap()
        }
        Err(msg) => {
            println!("Error reading socket: {}", msg);
            return;
        }
    };

    match reader.read_until(b'0', &mut buf) {
        Ok(0) => return,
        Ok(1) => {
            // first get the message
            let msg = {
                MESSAGE_MAP
                    .lock()
                    .unwrap()
                    .deref_mut()
                    .get_mut(&connection_id)
                    .unwrap()
                    .take()
                    .unwrap()
            };
            match msg {
                Message::OpenIndex(name, options) => {
                    let mut index: Option<Arc<MvccRwLock<OpenedIndex>>> = None;
                    let resp = {
                        let mut guard = OPEN_INSTANCES.lock().unwrap();
                        let mut map = guard.deref_mut();
                        let needs_opening = match map.get_mut(&name) {
                            None => true,
                            Some(opened_index) => {
                                index = Some(opened_index.clone());
                                opened_index.write().unwrap().open_count += 1;
                                false
                            }
                        };
                        if needs_opening {
                            match Index::open(&name, options) {
                                Ok(new_index) => {
                                    let new_index = Arc::new(MvccRwLock::new(OpenedIndex {
                                                                                 index: new_index,
                                                                                 open_count: 1,
                                                                             }));
                                    map.insert(name.clone(), new_index.clone());
                                    index = Some(new_index);
                                    Message::ResponseOk(JsonValue::True)
                                }
                                Err(msg) => Message::ResponseError(msg.description().to_string()),
                            }
                        } else {
                            Message::ResponseOk(JsonValue::True)
                        }
                    };
                    // put the response in the queue
                    {
                        *MESSAGE_MAP
                             .lock()
                             .unwrap()
                             .deref_mut()
                             .get_mut(&connection_id)
                             .unwrap() = Some(resp);
                    }

                    {
                        // notify the client the response is ready
                        let mut writer = reader.get_mut();
                        writer.write_all(&[b'1']).unwrap();
                        writer.flush().unwrap();
                    }
                    if index.is_some() {
                        let index_guard = OpenedIndexCleanupGuard { index: index.unwrap() };
                        // now start servicing instance requests
                        let result = panic::catch_unwind(|| {
                                                             handle_client(index_guard,
                                                                           reader,
                                                                           connection_id);
                                                         });
                        if result.is_err() {
                            println!("panic happend!")
                        }
                    }
                    {
                        // clean up message slot
                        MESSAGE_MAP
                            .lock()
                            .unwrap()
                            .deref_mut()
                            .remove(&connection_id);
                    }
                }
                Message::DropIndex(name) => {
                    let mut guard = OPEN_INSTANCES.lock().unwrap();
                    let map = guard.deref_mut();
                    let resp = if map.contains_key(&name) {
                        Message::ResponseError("Index instances still open".to_string())
                    } else {
                        match Index::drop(&name) {
                            Ok(()) => Message::ResponseOk(JsonValue::True),
                            Err(msg) => Message::ResponseError(msg.description().to_string()),
                        }
                    };
                    {
                        // put the response in the queue
                        *MESSAGE_MAP
                             .lock()
                             .unwrap()
                             .deref_mut()
                             .get_mut(&connection_id)
                             .unwrap() = Some(resp);
                    }
                    {
                        // notify the client the response is ready
                        let mut writer = reader.get_mut();
                        writer.write_all(&[b'1']).unwrap();
                        writer.flush().unwrap();
                    }

                    // when the socket closes we'll know we can clean up the message slot.
                    let _ = reader.read_until(b'0', &mut buf);
                    {
                        // clean up message slot
                        MESSAGE_MAP
                            .lock()
                            .unwrap()
                            .deref_mut()
                            .remove(&connection_id);
                    }

                }
                _ => panic!("unexpected message"),
            }
        }
        Ok(_size) => panic!("WTF, more than one byte read!"),
        Err(msg) => println!("Error reading socket: {}", msg),
    }
}

fn handle_client(mut index: OpenedIndexCleanupGuard,
                 mut reader: BufReader<UnixStream>,
                 connection_id: u64) {
    let mut buf = Vec::new();
    loop {
        // from now on the stream only sends a single byte on value 0
        // to indicate there is a message waiting,
        match reader.read_until(b'0', &mut buf) {
            Ok(0) => break,
            Ok(1) => {
                // first get the message
                let msg = {
                    MESSAGE_MAP
                        .lock()
                        .unwrap()
                        .deref_mut()
                        .get_mut(&connection_id)
                        .unwrap()
                        .take()
                        .unwrap()
                };

                if let Message::Close = msg {
                    drop(index); // make sure index instance is closed first
                    return; // now we end the loop. The client will notice the socket close.
                }
                // process the message
                let response = process_message(&mut index, msg);

                // put the response in the queue
                {
                    *MESSAGE_MAP
                         .lock()
                         .unwrap()
                         .deref_mut()
                         .get_mut(&connection_id)
                         .unwrap() = Some(response);
                }

                // notify the client the response is ready
                let mut writer = reader.get_mut();
                writer.write_all(&[b'1']).unwrap();
                writer.flush().unwrap();

            }
            Ok(_size) => panic!("WTF, more than one byte read!"),
            Err(msg) => println!("Error reading socket: {}", msg),
        }
    }
}

fn process_message(index: &mut OpenedIndexCleanupGuard, message: Message) -> Message {
    match message {
        Message::Add(vec) => {
            let mut results = Vec::with_capacity(vec.len());
            let mut batch = Batch::new();
            let ref mut index = index.write().unwrap().index;
            for doc_str in vec {
                match index.add(&doc_str, &mut batch) {
                    Ok(id) => results.push(JsonValue::String(id)),
                    Err(reason) => {
                        let err_str = JsonValue::String(reason.description().to_string());
                        let err_obj = vec![("error".to_string(), err_str)];
                        results.push(JsonValue::Object(err_obj))
                    }
                }
            }
            match index.flush(batch) {
                Ok(()) => Message::ResponseOk(JsonValue::Array(results)),
                Err(reason) => Message::ResponseError(reason.description().to_string()),
            }
        }
        Message::Delete(vec) => {
            let ref mut index = index.write().unwrap().index;
            let mut batch = Batch::new();
            let mut results = Vec::with_capacity(vec.len());
            for doc_str in vec {
                match index.delete(&doc_str, &mut batch) {
                    Ok(true) => results.push(JsonValue::True),
                    Ok(false) => results.push(JsonValue::False),
                    Err(reason) => {
                        let err_str = JsonValue::String(reason.description().to_string());
                        let err_obj = vec![("error".to_string(), err_str)];
                        results.push(JsonValue::Object(err_obj))
                    }
                }
            }
            match index.flush(batch) {
                Ok(()) => Message::ResponseOk(JsonValue::Array(results)),
                Err(reason) => Message::ResponseError(reason.description().to_string()),
            }
        }
        Message::Query(query, params) => {
            let ref index = index.read().index;
            let msg = match index.query(&query, params) {
                Ok(results) => {
                    let mut vec: Vec<JsonValue> = results.collect();
                    vec.reverse(); // reverse so the client iterator can pop vals off end.
                    Message::ResponseOk(JsonValue::Array(vec))
                }
                Err(reason) => Message::ResponseError(reason.description().to_string()),
            };
            msg
        }
        Message::Close => {
            panic!("Can't get close message here!");
        }
        Message::ResponseOk(_json) => {
            panic!("Got ResponseOk on wrong side!");
        }
        Message::ResponseError(_string) => {
            panic!("Got ResponseError on wrong side!");
        }
        Message::OpenIndex(_, _) => {
            panic!("Can't get OpenIndex message here!");
        }
        Message::DropIndex(_) => {
            panic!("Can't get DropIndex message here!");
        }
    }
}

register_module!(m, {
    m.export("startListener", js_start_listener)?;
    m.export("getResponse", js_get_response)?;
    m.export("sendMessage", js_send_message)?;
    m.export("queryNext", js_query_next)?;
    m.export("getError", js_get_error)?;
    m.export("queryUnref", js_query_unref)
});
