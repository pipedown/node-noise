# Description

Noise is a JSON full text and query engine that runs directly inside of Node.js.

It's written in [Rust](https://www.rust-lang.org) and uses [RocksDB](http://rocksdb.org/) as the storage layer.


# Installation

Currently only OS X and Linux are supported. Help wanted for porting to other platforms.

You'll need to install the [Rust Compiler](https://www.rust-lang.org/en-US/install.html) before installing the NPM package.

# Query Language

The Noise query language is an expressive example-based syntax for finding documents, formatting and returning specific information in the documents, performing relevancy scoring, ordering and aggregations.

[The query language reference is here.](https://github.com/pipedown/noise/blob/master/query_language_reference.md)


# Javascript API

The API for Noise is Promise based. Each method returns a Promise which will then notify asynchronously the success or failure of the method call.

## Opening an Index

To open an existing index, use the open method on the `noise` object.

To create a new index, pass in a second argument of `true` which means "create if missing".

```javascript
var noise = require('noise-search'),
    assert = require('assert');

let index = noise.open("myindex", true);

```

## Adding Documents

After the index is opened you use `add` method on the index to add documents. See the [Documents](#documents) section for more information about the document structure.

You can add a single document, or batch documents into an array. Batching many documents is much faster than adding single documents at a time.

The successful return result is an array of the ids of the array corresponding to the array supplied. If a document can't be inserted for some reason (for example you set `_id` field to a non-string) it has an `{"error": "<reason>"}` in its array slot.

```javascript

// add documents -- batch is faster
index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
	assert.equal(2, resp.length, "added 2 documents");

	// add a document -- single is slower
    return index.add({_id:"c",foo:"bar"});

}).then(resp => {
	assert.equal(1, resp.length, "added 1 document");

}).catch(error => {
    console.log("error: " + error);
});
```

If you add a document with the same `_id` as a previously added document, the document is then replaced with the new document.

## Querying

To perform a query, use the `.query(...)` on the index object, which returns an iterator. Call the `.next()` method on the iterator to iterate though the values. See the [Query Language](#query-language) section for more information about the query syntax. The return value is always an array of the matching documents. See the [Return Clause](#return-clause) section for more information about the possible return values.

```javascript
index.query('find {foo: =="bar"}').then(iter => {
    assert.equal(iter.next().value, "a", "doc a found");
}
```

The iterator is also a iterable, so you can use it in a `for ... of` loop:

```javascript
index.query('find {foo: =="bar"}').then(iter => {
    for (let value of iter) {
        console.log(value);
    }
}
```

If you want to not iterate through all results, you must call the `.unref()` method on ther iterator. Otherwise the index instance may hang on subsequent queries.

```javascript
index.query('find {foo: =="bar"}').then(iter => {
    let first = iter.next();
    if (!first.done) {
        console.log(value);
    }
    iter.unref();
}
```

You can also use parameterized queries, to avoid the problems of improperly escaping strings when building queries from untrusted sources.

```javascript
let userInput = form.getUserInput();
// oops the next line is susceptible to malicious input! 
index.query('find {foo: =="' + userInput + '"}').then(iter => {
    assert.equal(iter.next().value, "a", "doc a found");
}
```

Indicate parameters with `@paramName` inside the query. Then pass in a object with the same `paramName` and the unescaped value in second argument.

```javascript
let userInput = form.getUserInput();
// no way for malicious input to affect us!
index.query('find {foo: == @userInput}', {userInput: userInput}).then(iter => {
    assert.equal(iter.next().value, "a", "doc a found");
}
```

You can use any number of parameters. A @parameter can be repeated in the query for multiple fields. If a @parameter in the query isn't in the parameter object, it's an error.

## Deleting Documents

You can delete documents by passing in an array of `_id`s of the documents to the `.delete(...)` method. It returns an array of booleans where each elements indicates whether the deletion of the individual document was successful or not.

```javascript
index.delete(["a", "b"]).then(resp => {
    assert.deepEqual(resp, [true, true], "doc a and b deleted");
}.catch(error => {
    console.log("error: " + error);
});
```

## Closing an Index

To close an index, use the `.close()` method. Returns `true` on success.

```javascript
index.close().then(() => {
    assert.ok(true, "index closed");
}.catch(error => {
    console.log("error: " + error);
});
```

## Drop: Deleting an Entire Index

To delete a whole index (all index files deleted from disk irreversibly) use the drop method on the `noise` object.

For this to work **ALL INSTANCES OF THE INDEX MUST BE CLOSED FIRST**. Returns `true` on success.

```javascript
noise.drop("myindex").then(() => {
    assert.ok(true, "index dropped");
}.catch(error => {
    console.log("error: " + error);
});
```

## A Complete Example

```javascript
var noise = require('noise-search'),
    assert = require('assert');

var index = noise.open("myindex", true);
index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
    assert.deepEqual(resp, ["a","b"], "docs created");
    return index.query('find {foo: =="bar"}')
}).then(iter => {
    let id = iter.next().value;
    assert.equal(id, "a", "doc a found");
    return index.delete(id);
}).then(resp => {
    assert.deepEqual(resp, [true], "doc a deleted");
    return index.close();
}).then(() => {
    assert.ok(true, "index closed");
    return noise.drop("myindex");
}).then(() => {
    assert.ok(true, "index dropped");
}).catch(error => {
    if (index) {
        index.close();
    }
    console.log("error: " + error);
});
```

## Concurrency and Multiple Instances

Each instance of an index opened can only respond to one request at a time. To improve concurrency, open multiple instances of the same index. Each will run in its own background thread and service the request, utilizing more cores and preventing long running queries from blocking others.

Adding documents to multiple instances at the same time is safe.

Be careful about opening too many instances. The cost of context switching for many threads starts to dominate CPU and slows down all instances.


# Documents

The JSON inserted into the index must be an object type (`{}`). There is no set limit on the size, structure or types of the documents other than being valid JSON and respecting the `_id` field.

## _id Field

Documents inserted into the index can include a special `_id` field at the root of the document to identify the document. You can use this field to overwrite and delete previously inserted document. The `_id` field MUST be a text value.

If you do not include an `_id` field, a [UUID](https://en.wikipedia.org/wiki/Universally_unique_identifier) will be generated and assigned to the `_id` field in the document.



