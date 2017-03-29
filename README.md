# Description

Noise is a JSON full text and query engine that runs directly inside of Node.js.

It's written in Rust and uses RocksDB as the storage layer.


# Installation

Currently only OS X and Linux are supported. Help wanted for porting to other platforms.

You'll need to install the [Rust Compiler](https://www.rust-lang.org/en-US/install.html) before installing the NPM package. 


# Javascript API

The API for Noise is Promise based. Each method returns a Promise which will then notify asynchronously the success or failure of the method call.

##Opening an Index

To open an existing index, use the open method on the `noise` object.

To create a new index, pass in a second argument of `true` which means "create if missing".

```javascript
var noise = require('noise-search'),
    assert = require('assert');

let index;
noise.open("myindex", true).then(retIndex => {
    index = retIndex;
}).catch(error => {
    console.log("error: " + error);
});

```

##Adding Documents

After the index is opened you use `add` method on the index to add documents.

You can add a single document, or batch documents into an array. Batching many documents is much faster than adding single documents at a time.

The successful return result is an array of the ids of the array corresponding to the array supplied. If a document can't be inserted for some reason (for example you set `_id` field to a non-string) it has an `{"error": "<reason>}` in its array slot. some

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

If you add a document with the same _id as a previously added document, the document is then replaced with the new document.

## Querying

To perform a query, use the `.query(...)` on the index object.

```javascript
index.query('find {foo: =="bar"}').then(resp => {
    assert.deepEqual(resp, ["a"], "doc a found");
}
```

##Deleting Documents

You can delete documents by passing in the _id of the documents to the `.delete(...)` method.

```javascript
index.delete(["a", "b"]).then(resp => {
    assert.deepEqual(resp, [true, true], "doc a and b deleted");
}.catch(error => {
    console.log("error: " + error);
});
```

##Closing an index

To close an index, use the `.close()` method.

```javascript
index.close().then(() => {
    assert.ok(true, "index closed");
}.catch(error => {
    console.log("error: " + error);
});
```

##Drop: Deleting an Entire Index

To delete a whole index (all index files deleted from disk irreversibly) use the drop method on the `noise` object.

For this to work **ALL INSTANCES OF THE INDEX MUST BE CLOSED FIRST**.

```javascript
noise.drop("myindex").then(() => {
    assert.ok(true, "index dropped");
}.catch(error => {
    console.log("error: " + error);
});
```

##A Complete Example

```javascript
var noise = require('noise-search'),
    assert = require('assert');
    
var index;
noise.open("myindex", true).then(retIndex => {
    assert.ok(retIndex, "index opened/created");
    index = retIndex;
    return index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]);
}).then(resp => {
    assert.deepEqual(resp, ["a","b"], "docs created");
    return index.query('find {foo: =="bar"}')
}).then(resp => {
    assert.deepEqual(resp, ["a"], "doc a found");
    return index.delete(resp);
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

Be careful about opening too many instances. The cost of context switching for many threads start to dominate CPU and slow down all instances.


# Documents

The JSON inserted into the index must be an object type (`{}`). There is no set limit on the size, structure or types of the documents other than being valid JSON and respecting the `_id` field.

##_id Field

Documents inserted into the index can include a special `_id` field at the root of the document to identify the document. You can use this field to overwrite and delete previously inserted document. The `_id` field MUST be a text value.

If you do not include an `_id` field, a UUID will be generated and assigned to the `_id` field in the document.

# Query Language

The Noise query language is an expressive example-based syntax for finding documents, formatting and returning specific information in the documents, performing relevancy scoring, sorting and aggregations.

## Find Clause

All queries have a find clause followed by an example based query syntax.

This query will return the `_id` of every document with a `{"foo": "bar",...}`

```
find {foo: == "bar"}
```

To match on multiple fields, or even nested fields, simply construct the same json structure in query form.

Match on two fields:

```
find {foo: == "bar", fizz: == "buzz"}
```

Match on fields, one nested within another:

```
find {foo: == "bar", fizz: {fazz: == "buzz"}}
```

### Word Match Operator

`~=` is the full text match operator. Use it find a word in a text field.

```
find {body: ~= "word"}
```

Put multiple words in the quoted string to find a phrase in the field.

```
find {body: ~= "a multi word sentence"}
```

To find words that are within a specified distance of each other, put the the maximum word distance in the operator. This example will return results where each word is with the 50 words of the others.

```
find {body: ~50= "bitcoin gold price"}
```

### Comparison Operators

Noise supports the following comparison operators:

|Operator|Description|
---------|-----------
|`==`|Equality|
|`>`|Less Than|
|`<`|Greater Than|
|`>=`|Less Than or Equal|
|`<=`|Greater Than or Equal|

Noise does not do type conversions of datatypes. Strings only compare with strings, number only compare with numbers.

`null` `true` and `false` only work with `==`.

### Finding Things in Arrays

Let's say you have document like this with text in an array:

```
{"foo":["bar", "baz"]}
```

To find element with value `"baz"` in the array, use syntax like this:

```
find {foo:[ =="baz"]}
```

If objects are nested in array, like this:

```
{"foo":[{"fiz":"bar"}, {"fiz":"baz"}]}
```

To find a `{"fiz":"baz"}` in the array, use syntax like this:

```
find {foo:[{fiz: == "baz"}]}
```

### Boolean Logic and Parens

Noise has full support for boolean logic using `&&` (logical AND) and `||` (logical OR) operators and nesting logic with parens.

The comma `,` in objects is actually the same as the `&&` operator. They can be used interchangeably for which ever is more readable.

Find a doc with foo or bar in the body:

```
find {body: ~= "foo" || body: ~= "bar"}
```

Find a doc that has foo or bar and has baz or biz in the body:

```
find {(body: ~= "foo" || body: ~= "bar") && (body: ~= "baz" || body: ~= "biz")}
```

The fields can be nested as well:

```
find {foo: {fiz: ~= "baz" || fiz: ~= "biz"}}
```


### Not Operator

Use the `!` (logical NOT) to exclude matching criteria.

Find docs where foo has value "bar" and fab does not have value "baz":

```
find {foo: == "bar", fab: !== "baz"}
```

You can use logical not with parens to negate everything enclosed. This example finds docs where foo has value "bar" and fab does not have value "baz" or biz':

```
find {foo: == "bar", !(fab: == "baz" || fab: == "biz")}
```

You cannot have every clause be negated. Query need at least one non-negated clauses.

Illegal:

```
find {foo: !~= "bar" && foo: !~= "baz"}
```

Illegal:

```
find {!(foo: ~= "bar" && foo: ~= "baz"})
```

Also double negation is not allowed.

Illegal:

```
find {foo ~= "waz" && !(foo: ~= "bar" && foo: !~= "baz"})
```

### Relevancy Scoring and Boosting

Relevancy scoring uses a combination boolean model and Term Frequency/Inverse Document Frequency (TF/IDF) scoring system, very similar to Lucene and Elastic Search. The details of the scoring model is beyond the scope of the document.

To return results in relevancy score order (most relevant first), simply use the sort clause with the `score()` function.

```
find {subject: ~= "hammer" || body: ~= "hammer"}
sort score() desc
```

But if want matches in subject fields to score higher than in body fields, you can boost the score with the `^` operator. It is a multiplier of the scores of associated clauses.

This boosts subject matches by 2x:

```
find {subject: ~= "hammer"^2 || body: ~= "hammer"}
sort score() desc
```

You can also boost everything in parenthesis or objects or arrays:

```
find {(subject: ~= "hammer" || subject: ~= "nails")^2 || 
       body: ~= "hammer" ||  body: ~= "nails"}
sort score() desc
```
Another way to express the same thing:

```
find {subject: ~= "hammer" || subject: ~= "nails"}^2 ||
     {body: ~= "hammer" || body: ~= "nails"}
sort score() desc
```


## Sort Clause

To sort results in a particular order, use the sort clause.

This will sort results ascending based on the contents of the `baz` field:

```
find {foo: =="bar"}
sort .baz
```

If `baz` doesn't existing, `null` be the value used for sorting.

This will sort `baz` descending:

```
find {foo: =="bar"}
sort .baz
```

This will sort `baz` ascending:

```
find {foo: =="bar"}
sort .baz asc
```

This will sort `baz` ascending with default value of `1` if no `baz` value exists:

```
find {foo: =="bar"}
sort .baz asc default=1
```

This will sort `baz` ascending, for values of `baz` that are the same, those results are now sorted as `biz` ascending.

```
find {foo: =="bar"}
sort .baz asc, .biz dsc
```

## Return Clause

The return clause is how data or scoring is returned to the client. You can extract the whole document, a single field, multiple fields, and perform aggregations.

### Basic Dot Notation

A leading dot indicates the root of the document. To return the whole document, place a single dot in return clause.

This will return the whole document for each document found.

```
find {foo: == "bar"}
return .
```

To return a specific field, place the field name after the dot:

```
find {foo: == "bar"}
return .baz
```

To return a nested field, use another dot:

```
find {foo: == "bar"}
return .baz.biz
```

To return an array element, use the array notation:

```
find {foo: == "bar"}
return .baz[1]
```

To return aa object field nested in the array, add a dot after the array notation:

```
find {foo: == "bar"}
return .baz[1].biz
```

To return multiple values, embed the return paths in other json structures.

For each match this example return 2 values inside an array:

```
find {foo: == "bar"}
return [.baz, .biz]
```

For each match this example return 2 values inside an object:

```
find {foo: == "bar"}
return {baz: .baz, biz: .biz}
```

### Missing Values

Sometimes you'll want to return a field that doesn't exist on a matching document. When that happens, `null` is returned.

If you'd like a different value to be returned, use the `default=<json>` option, like this:

```
find {foo: == "bar"}
return .baz default=0
```

Each returned value can have a default as well.

```
find {foo: == "bar"}
return {baz: .baz default=0, biz: .biz default=1}
```



### Array Star (*) Syntax

If want to return a nested field inside an array, but for each object in the array, use the `*` operator.

This will return each biz field as an array of values:

```
find {foo: == "bar"}
return .baz[*].biz
```

### Bind Variables: Return Only Matched Array Elements

If you are searching for nested values or objects nested in arrays, and you want to return only the match objects, use the bind syntax before the array in the query.

Say you have a document like this:

```
{"foo":[{"fiz":"bar", "val":4}, {"fiz":"baz", "val":7}]}
```

You want to return the object where `{"fiz":"bar",...}`, use you a bind variable (`var::[...]`), like this:

```
find {foo: x::[{fiz: == "bar"}]}
return x
```

If instead you want to return the `val` field, add the `.val` to the bind variable like this:

```
find {foo: x::[{fiz: == "bar"}]}
return x.val
```

You can have any number of bind variables:

```
find {foo: x::[{fiz: == "bar"}], foo: y::[{fiz: == "baz"}]}
return [x.val, y.val]
```

You can reuse bind variables in different clauses and they'll be combined:

```
find {foo: x::[{fiz: == "bar"}] || faz: x::[{fiz: == "bar"}]}
return [x.val]
```

##Limit Clause

To limit the number of results, use a limit clause at the end of the query.

This limits the results to the first 10 found:

```
find {foo: == "bar"}
return .baz
limit 10
```


## Grouping and Aggregation

Noise includes ways to group rows together and aggregate values.

Values you want to group together use `group(...)` function in the `return` clause.

For values that are grouped together you can then perform aggregations on other values and return that aggregation.

The aggregation functions available are:

|function      | Description|
---------------|-------------
|`array(...)`|Returns all values in the group as values in an array.|
|`array_flat(...)`|Returns all values in the group as values in an array. However if an array is encountered it extracts all the values inside the array (and further nested arrays) and returns them as a singe flat array|
|`avg(...)`|Averages numeric values in the group. If numeric values are in arrays, it extracts the values from the arrays. Even if arrays are nested in arrays, it extracts through all levels of nested arrays and averages them. |
|`count()`| Returns the count of the grouped rows for each grouping. |
|`concat(...sep="...")`| Returns all the strings in the group as a single concatenated string. Other value types are ignored. Use the optional `sep="..." to specify a separator between string values.|
|`max(...)`|Returns the maximum value in the group. See type ordering below to see how different types are considered. |
|`max_array(...)`|Returns the maximum value in the group, if array is encountered the values inside the array are extracted and considered.|
|`min(...)`|Returns the minimum value in the group. See type ordering below to see how different types are considered.|
|`min_array(...)`|Returns the minimum value in the group, if array is encountered the values inside the array are extracted and considered.|
|`sum(...)`|Sums numeric values in the group. If numeric values are in arrays, it extracts the values from the arrays. Even if arrays are nested in arrays, it extracts through all levels of nested arrays and sums them.|

To perform grouping and/or aggregate, each field returned will need either a grouping or a aggregate function. It's an error it on some returned fields but not others.

Groupings are are sorted first on the leftmost `group(...)` function, then on the next leftmost, etc.

You do not need to use `group(...)` to perform aggregates. If you have no `group(...)` defined, then all rows are aggregated into a single row.



### Max/Min Type Ordering
The ordering of types for `max(...)` and `min(...)` is as follows:

null < false < true < number < string < array < object


## Group/Aggregate Examples:


Let's say we have documents like this:

```
{"foo":"group1", "baz": "a", "bar": 1}
{"foo":"group1", "baz": "b", "bar": 2}
{"foo":"group1", "baz": "c", "bar": 3}
{"foo":"group1", "baz": "a", "bar": 1}
{"foo":"group1", "baz": "b", "bar": 2}
{"foo":"group1", "baz": "c", "bar": 3}
{"foo":"group1", "baz": "a", "bar": 1}
{"foo":"group1", "baz": "b", "bar": 2}
{"foo":"group1", "baz": "c", "bar": 3}
{"foo":"group1", "baz": "a", "bar": 1}
{"foo":"group1", "baz": "b", "bar": 2}
{"foo":"group1", "baz": "c", "bar": 3}
{"foo":"group2", "baz": "a", "bar": "a"}
{"foo":"group2", "baz": "a", "bar": "b"}
{"foo":"group2", "baz": "b", "bar": "a"}
{"foo":"group2", "baz": "b", "bar": "b"}
{"foo":"group2", "baz": "a", "bar": "a"}
{"foo":"group2", "baz": "a", "bar": "c"}
{"foo":"group2", "baz": "b", "bar": "d"}
{"foo":"group2", "baz": "b", "bar": "e"}
{"foo":"group2", "baz": "a", "bar": "f"}
{"foo":"group3", "baz": "a", "bar": "a"}
("foo":"group3",             "bar": "b"}
{"foo":"group3", "baz": "b", "bar": "a"}
{"foo":"group3", "baz": "b", "bar": "b"}
{"foo":"group3", "baz": "a", "bar": "a"}
{"foo":"group3", "baz": "a"            }
{"foo":"group3", "baz": "b", "bar": "d"}
{"foo":"group3", "baz": "b", "bar": "e"}
{"foo":"group3", "baz": "a", "bar": "f"}
```

###Count

Query:
```
find {foo: == "group1"}
return {baz: group(.baz), count: count()}
```
Results:

```
{"baz":"a","bar":4}
{"baz":"b","bar":4}
{"baz":"c","bar":4}

```

###Sum

Query:

```
find {foo: == "group1"}
return {baz: group(.baz), bar: sum(.bar)}
```

Results:

```
{"baz":"a","bar":4}
{"baz":"b","bar":8}
{"baz":"c","bar":12}

```

###Avg

Query:

```
find {foo: == "group1"}
return {avg: avg(.bar)}
```

Results:

```
{"bar":2}
```

###Concat

Query:

```
find {foo: =="group1"}
return {baz: group(.baz), concat: concat(.baz sep="|")}
```

Results:

```
{"baz":"a","concat":"a|a|a|a"}
{"baz":"b","concat":"b|b|b|b"}
{"baz":"c","concat":"c|c|c|c"}
```

###Max

Query:

```
find {foo: =="group1"}
return {max: max(.bar)}
```
Results:

```
{"max":3}
```

Query:

```
find {foo: =="group1"}
return {max: max(.baz)}
```

Results:

```
{"max":"c"}
```

###Min

Query:

```
find {foo: =="group1"}
return {min: min(.bar)}
```

Results:

```
{"min":1}
```

###Group Ordering

Query:

```
find {foo: =="group2"}
return [group(.baz order=asc), group(.bar order=desc), count()]
```

Results:

```
["a","f",1]
["a","c",1]
["a","b",1]
["a","a",2]
["b","e",1]
["b","d",1]
["b","b",1]
["b","a",1]
```

###Default Values

Query:

```
find {foo: =="group2"}
return [group(.baz order=asc) default="a", group(.bar order=desc) default="c", count()];
```

Results:

```
["a","f",1]
["a","c",1]
["a","b",1]
["a","a",2]
["b","e",1]
["b","d",1]
["b","b",1]
["b","a",1]
```

###Arrays

When performing aggregations on arrays, some functions will extract values out of the arrays (and arrays nested in arrays).

We have documents like this:

```
{"foo":"array1", "baz": ["a","b",["c","d",["e"]]]}
{"foo":"array1", "baz": ["f","g",["h","i"],"j"]}
{"foo":"array2", "baz": [1,2,[3,4,[5]]]}
{"foo":"array2", "baz": [6,7,[8,9],10]};
```

Query:

```
ind {foo: =="array1"}
return array(.baz)
```

Results:

```
[["f","g",["h","i"],"j"],["a","b",["c","d",["e"]]]]
```

Query:

```
find {foo: =="array1"}
return array_flat(.baz)
```

Results:

```
["f","g","h","i","j","a","b","c","d","e"]
```

Query:

```
find {foo: =="array1"}
return max(.baz)
```

Results:

```
["f","g",["h","i"],"j"]
```

Query:

```
find {foo: =="array1"}
return max_array(.baz)
```

Results:

```
"j"
```

Query:

```
find {foo: =="array1"}
return min_array(.baz)
```

Results:

```
"a"
```

Query:

```
find {foo: =="array2"}
return avg(.baz)
```

Results:

```
5.5
```

Query:

```

find {foo: =="array2"}
return sum(.baz)
```

Results:

```
55
```

