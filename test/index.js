var noise = require('../lib/noise.js');

// if test function expects second named argument it will be executed 
// in async mode and test will be complete only after callback is called 
exports['test basic'] = function(assert, done) {
    var index;
    noise.open("firstrealtest", true).then(retIndex => {
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
        return noise.drop("firstrealtest");
    }).then(() => {
        assert.ok(true, "index dropped");
    }).catch(error => {
        if (index) {
            index.close();
        }
        console.log("error: " + error);
    });
}
 
var co = require('co');

exports['test yield'] = function(assert, done) {
    co(function*() {
        // open an index. `true` means if it doesn't exist, create one.
        var index = yield noise.open("first_index", true);
        assert.ok(index, "index opened/created");

        // Insert multiple documents
        var r = yield index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]);
        assert.equal(2, r.length, "added 2 documents");

        // find one of the documents
        var r = yield index.query('find {foo: =="bar"}');    
        assert.deepEqual(r, ["a"], "doc \"a\" found");
        
        // delete that document
        var r = yield index.delete(r);
        assert.deepEqual(r, [true], "doc \"a\" deleted");

        // Close connection
        yield index.close();
        assert.ok(true, "index closed");

        // `drop` the index, completely removing all data from disk.
        yield noise.drop("first_index");
        assert.ok(true, "index dropped");

    }).catch(function(err) {
        console.log(err.stack);
    });
};

if (module == require.main) require('test').run(exports)
