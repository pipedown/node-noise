var assert = require('node:assert');
var test = require('test');

var noise = require('../lib/noise.js');

// if test function expects second named argument it will be executed 
// in async mode and test will be complete only after callback is called 
test('test basic', function(t, done) {
    var index = noise.open("tmp/firstrealtest", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a","b"], "docs created");
        return index.query('find {foo: =="bar"}')
    }).then(iter => {
        let id = iter.next().value;
        assert.equal(id, "a", "doc a found");
        assert.equal(iter.next().done, true, "end");
        return index.delete(id);
    }).then(resp => {
        assert.deepEqual(resp, [true], "doc a deleted");
        return index.close();
    }).then(() => {
        assert.ok(true, "index closed");
        return noise.drop("tmp/firstrealtest");
    }).then(() => {
        assert.ok(true, "index dropped");
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test iterable', function(t, done) {
    var index = noise.open("tmp/iterabletesttest", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a","b"], "docs created");
        return index.query('find {foo: =="bar" || foo: =="baz"}');
    }).then(iter => {
        let ids = [];
        for (let value of iter) {
            ids.push(value);
        }
        assert.deepEqual(ids, ["a", "b"], "doc a and b found");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test params', function(t, done) {
    var index = noise.open("tmp/paramstest", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a","b"], "docs created");
        return index.query('find {foo: ==@f1 || foo: ==@f2}', {f1:"bar", f2:"baz"});
    }).then(iter => {
        let ids = [];
        for (let value of iter) {
            ids.push(value);
        }
        assert.deepEqual(ids, ["a", "b"], "doc a and b found");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test bad open', function(t, done) {
    var index = noise.open("", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        console.log(resp);
        assert.ok(false, "this should have failed");
    }).catch(error => {
        assert.ok(true, "expected: " + error);
        done();
    });
});

test('test bad query', function(t, done) {
    var index = noise.open("tmp/badquery", true);
    index.query('find {foo: =="bar"').then(resp => {
        console.log(resp);
        assert.ok(false, "this should have failed");
    }).catch(error => {
        assert.ok(true, "expected: " + error);
        index.close().then(() => {
            return noise.drop("tmp/badquery");
        }).then(() => {
            done();
        }).catch(error => {
            assert.ok(false, "unexpected error: " + error);
        })
    });
});

test('test multi concurrent add', function(t, done) {
    var index = noise.open("tmp/multiadd", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a", "b"], "added a and b");
    }).catch(error => {
        assert.ok(false, "failed" + error);
    });
    index.add([{_id:"c",foo:"bar"}, {_id:"d", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["c", "d"], "added c and d");
        return index.close();
    }).then(() => {
        return noise.drop("tmp/multiadd");
    }).then(() => {
        // make sure deleted
        var index = noise.open("tmp/multiadd", false);
        index.add({foo:"bar"}).then(() => {
            assert.ok(false, "add should have failed");
        }).catch(err => {
            assert.ok(true, "dropped index didn't reopen");
            // for some damn reason attempting to open an non-existant
            // index creates the dir and a LOG and LOCK file. clean it up here.
            noise.drop("tmp/multiadd").then(() => {
                done();
            });
        });
    }).catch(error => {
        assert.ok(false, "failed" + error);
    });
});

test('test multi instances opened', function(t, done) {
    var index1 = noise.open("tmp/multiinst", true);
    var index2;
    index1.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a", "b"], "added a and b");
        index2 = noise.open("tmp/multiinst", false);
        return index2.query('find {foo: == "bar"}');
    }).then(iter => {
        assert.equal(iter.next().value, "a", "found a on instance 2");
        assert.equal(iter.next().done, true, "done");
        return index2.close();
    }).then(() => {
        return index1.query('find {foo: == "bar"}');
    }).then(iter => {
        assert.equal(iter.next().value, "a", "found a on instance 1");
        assert.equal(iter.next().done, true, "done");
        return index1.close();
    }).then(() => {
        return noise.drop("tmp/multiinst");
    }).then(() => {
        var index = noise.open("tmp/multiinst", false);
        index.add({foo:'bar'}).then(resp => {
            assert.ok(false, "shouldn't happen");
        }).catch(err => {
            assert.ok(true, "dropped index didn't reopen");
            // for some damn reason attempting to open an non-existant
            // index creates the dir and a LOG and LOCK file. clean it up here.
            noise.drop("tmp/multiinst").then(() => {
                done();
            });
        });
    }).catch(error => {
        assert.ok(false, "failed " + error);
    });
});

test('test completely empty document', function(t, done) {
    var index = noise.open("tmp/emptydocument", true);
    var doc = {};
    var id;
    index.add([doc]).then(resp => {
        assert.equal(resp.length, 1, "doc created");
        id = resp[0];
        return index.query('find {_id: == "' + id + '"} return .');
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: id}, "Empty document is possible");
        assert.equal(iter.next().done, true, "done");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test document without _id', function(t, done) {
    var index = noise.open("tmp/withoutid", true);
    var doc = {foo: 'bar'};
    var id;
    index.add([doc]).then(resp => {
        assert.equal(resp.length, 1, "doc created");
        id = resp[0];
        return index.query('find {_id: == "' + id + '"} return .');
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: id, foo: "bar"},
                         "Document without _id is possible");
        assert.equal(iter.next().done, true, "done");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test document with _id only', function(t, done) {
    var index = noise.open("tmp/idonly", true);
    var doc = {_id: "a"};
    index.add([doc]).then(resp => {
        assert.deepEqual(resp, ["a"], "doc created");
        return index.query('find {_id: == "a"} return .');
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: "a"},
                         "Document with _id only is returned correctly");
        assert.equal(iter.next().done, true, "done");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test empty result', function(t, done) {
    var index = noise.open("tmp/emptyresulttest", true);
    index.query('find {_cannotbefound: ==true}').then(iter => {
        assert.equal(iter.next().value,
                     undefined,
                     "First `next()` call: .value is `undefined`");
        assert.equal(iter.next().done,
                     true,
                     "First `next()` call: .done is `true`");
        assert.equal(iter.next().value,
                     undefined,
                     "Second `next()` call: .value is `undefined`");
        assert.equal(iter.next().done,
                     true,
                     "Second `next()` call: .done is `true`");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test readme returns', function(t, done) {
    var index = noise.open("tmp/readmereturns", true);
    var doc = {
        "_id": "example",
        "foo": "bar",
        "baz": {"biz": "bar"},
        "faz": [
            {"fiz": 213},
            {"biz": 5463},
            {"biz": 73}
        ]
    };
    var find = 'find {foo: == "bar"} ';
    index.add([doc]).then(resp => {
        assert.deepEqual(resp, ["example"], "doc created");
        return index.query(find + 'return .');
    }).then(iter => {
        assert.deepEqual(Array.from(iter), [doc], "return . is correct");
        return index.query(find + 'return .baz');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [{"biz": "bar"}],
                         "return .baz is correct");
        return index.query(find + 'return .baz.biz');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         ["bar"],
                         "return .baz.biz is correct");
        return index.query(find + 'return .faz[1]');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [{"biz": 5463}],
                         "return return .faz[1] is correct");
        return index.query(find + 'return .faz[1].biz');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [5463],
                         "return .faz[1].biz is correct");
        return index.query(find + 'return [.baz, .faz]');
    }).then(iter => {
        assert.deepEqual(Array.from(iter), [[
            {"biz": "bar"},
            [{"fiz": 213}, {"biz": 5463}, {"biz": 73}]
        ]], "return [.baz, .faz] is correct");
        return index.query(find + 'return {baz: .baz, faz: .faz}');
    }).then(iter => {
        assert.deepEqual(Array.from(iter), [{
            "baz": {"biz": "bar"},
            "faz": [{"fiz": 213}, {"biz": 5463}, {"biz": 73}]
        }], "return {baz: .baz, faz: .faz} is correct");
        return index.query(find + 'return .hammer default=0');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [0],
                         "return .hammer default=0 is correct");
        return index.query(
            find + 'return {baz: .baz default=0, hammer: .hammer default=1}');
    }).then(iter => {
        assert.deepEqual(Array.from(iter), [{
            "baz": {"biz": "bar"},
            "hammer": 1
        }], "return {baz: .baz default=0, hammer: .hammer default=1} is correct");
        return index.query(find + 'return .faz[].biz');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [[5463, 73]],
                         "return .faz[].biz is correct");
        return index.close();
    }).then(() => {
        done()
    }).catch(error => {
        console.log(error);
    });
});

test('test readme bind variables', function(t, done) {
    var index = noise.open("tmp/readmebind", true);
    var doc = {
        _id: "a",
        foo: [
            {fiz: "bar", val: 4},
            {fiz: "baz", val: 7}
        ],
        bar: [
            {fiz: "baz", val: 9}
        ]
    };
    index.add([doc]).then(iter => {
        assert.deepEqual(Array.from(iter), ["a"], "doc created");
        return index.query('find {foo: x::[{fiz: == "bar"}]} return x');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [[{"fiz": "bar", "val": 4}]],
                         "return x is correct");
        return index.query('find {foo: x::[{fiz: == "bar"}]} return x.val');
    }).then(iter => {
        assert.deepEqual(Array.from(iter), [[4]], "return x.val is correct");
        return index.query(
            'find {foo: x::[{fiz: == "bar"}], foo: y::[{fiz: == "baz"}]} return [x.val, y.val]');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [[[4], [7]]],
                         "return [x.val, y.val] is correct");
        return index.query(
            'find {foo: x::[{fiz: == "bar"}], foo: y::[{fiz: == "baz"}]} return {x: x.val, y: y.val}');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [{"x": [4], "y": [7]}],
                         "return {x: x.val, y: y.val} is correct");
        return index.query(
            'find {foo: x::[{fiz: == "baz"}] || bar: x::[{fiz: == "baz"}]} return {"x": x.val}')
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         [{"x": [7, 9]}],
                         "combined bind is correct");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
    });
});

test('test iter unref', function(t, done) {
    var index = noise.open("tmp/iter_unref", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.equal(resp.length, 2, "docs created");
        return index.query('find {} return .');
    }).then(iter => {
        assert.equal(iter.next().done, false, "first doc");
        iter.unref();
        return index.query('find {} return .');
    }).then(iter => {
        assert.equal(iter.next().done, false, "first doc");
        assert.equal(iter.next().done, false, "second doc");
        assert.equal(iter.next().done, true, "done");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
        assert.ok(false, "should be no error");
    });
});

test('test geojson', function(t, done) {
    var index = noise.open("tmp/geojson", true);
    index.add([{_id:"point","geometry":{"type":"Point","coordinates":[10.9,48.4]}},
      {"_id":"linestring","geometry":{"type":"LineString","coordinates":[[102.0,0.0],[103.0,1.0],[104.0,0.0],[105.0,1.0]]}}
    ]).then(resp => {
        assert.equal(resp.length, 2, "docs created");
        return index.query('find {geometry: && [-180, -90, 180, 90]} return ._id');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         ["point", "linestring"],
                         "querying the whole world is correct");
        return index.query('find {geometry: && [0, 0, 50, 50]} return ._id');
    }).then(iter => {
        assert.deepEqual(Array.from(iter),
                         ["point"],
                         "querying a subset works");
        return index.close();
    }).then(() => {
        done();
    }).catch(error => {
        console.log(error);
        assert.ok(false, "should be no error");
    });
});
