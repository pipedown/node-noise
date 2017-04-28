var noise = require('../lib/noise.js');

// if test function expects second named argument it will be executed 
// in async mode and test will be complete only after callback is called 
exports['test basic'] = function(assert, done) {
    var index = noise.open("firstrealtest", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
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
        done();
    }).catch(error => {
        console.log(error);
    });
}

exports['test bad open'] = function(assert, done) {
    var index = noise.open("", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        console.log(resp);
        assert.ok(false, "this should have failed");
    }).catch(error => {
        assert.ok(true, "expected: " + error);
        done();
    });
}

exports['test bad query'] = function(assert, done) {
    var index = noise.open("badquery", true);
    index.query('find {foo: =="bar"').then(resp => {
        console.log(resp);
        assert.ok(false, "this should have failed");
    }).catch(error => {
        assert.ok(true, "expected: " + error);
        index.close().then(() => {
            return noise.drop("badquery");
        }).then(() => {
            done();
        }).catch(error => {
            assert.ok(false, "unexpected error: " + error);
        })
    });
}

exports['test multi concurrent add'] = function(assert, done) {
    var index = noise.open("multiadd", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a", "b"], "added a and b");
    }).catch(error => {
        assert.ok(false, "failed" + error);
    });
    index.add([{_id:"c",foo:"bar"}, {_id:"d", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["c", "d"], "added c and d");
        return index.close();
    }).then(() => {
        return noise.drop("multiadd");
    }).then(() => {
        // make sure deleted
        var index = noise.open("multiadd", false);
        index.add({foo:"bar"}).then(() => {
            assert.ok(false, "add should have failed");
        }).catch(err => {
            assert.ok(true, "dropped index didn't reopen");
            // for some damn reason attempting to open an non-existant
            // index creates the dir and a LOG and LOCK file. clean it up here.
            noise.drop("multiadd").then(() => {
                done();
            });
        });
    }).catch(error => {
        assert.ok(false, "failed" + error);
    });
};

exports['test multi instances opened'] = function(assert, done) {
    var index1 = noise.open("multiinst", true);
    var index2;
    index1.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a", "b"], "added a and b");
        index2 = noise.open("multiinst", false);
        return index2.query('find {foo: == "bar"}');
    }).then(resp => {
        assert.deepEqual(resp, ["a"], "found a on instance 2");
        return index2.close();
    }).then(() => {
        return index1.query('find {foo: == "bar"}')
    }).then((resp) => {
        assert.deepEqual(resp, ["a"], "found a on instance 1");
        return index1.close();
    }).then(() => {
        return noise.drop("multiinst");
    }).then(() => {
        var index = noise.open("multiinst", false);
        index.add({foo:'bar'}).then(resp => {
            assert.ok(false, "shouldn't happen");
        }).catch(err => {
            assert.ok(true, "dropped index didn't reopen");
            // for some damn reason attempting to open an non-existant
            // index creates the dir and a LOG and LOCK file. clean it up here.
            noise.drop("multiinst").then(() => {
                done();
            });
        });
    }).catch(error => {
        assert.ok(false, "failed " + error);
    });
};

exports['test completely empty document'] = function(assert, done) {
    var index = noise.open("emptydocument", true);
    var doc = {};
    var id;
    index.add([doc]).then(resp => {
        assert.equal(resp.length, 1, "doc created");
        id = resp[0];
        return index.query('find {_id: == "' + id + '"} return .');
    }).then(resp => {
        console.log(resp);
        assert.deepEqual(resp, [{_id: id}], "Empty document is possible");
        done();
    }).catch(error => {
        console.log(error);
    });
};

exports['test document without _id'] = function(assert, done) {
    var index = noise.open("withoutid", true);
    var doc = {foo: 'bar'};
    var id;
    index.add([doc]).then(resp => {
        assert.equal(resp.length, 1, "doc created");
        id = resp[0];
        return index.query('find {_id: == "' + id + '"} return .');
    }).then(resp => {
        console.log(resp);
        assert.deepEqual(resp, [{_id: id, foo: "bar"}],
                         "Document without _id is possible");
        done();
    }).catch(error => {
        console.log(error);
    });
};

exports['test document with _id only'] = function(assert, done) {
    var index = noise.open("idonly", true);
    var doc = {_id: "a"};
    index.add([doc]).then(resp => {
        assert.deepEqual(resp, ["a"], "doc created");
        return index.query('find {_id: == "a"} return .');
    }).then(resp => {
        console.log(resp);
        assert.deepEqual(resp, [{_id: "a"}],
                         "Document with _id only is returned correctly");
        done();
    }).catch(error => {
        console.log(error);
    });
};

exports['test readme returns'] = function(assert, done) {
    var index = noise.open("readmereturns", true);
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
    }).then(resp => {
        assert.deepEqual(resp, [doc], "return . is correct");
        return index.query(find + 'return .baz');
    }).then(resp => {
        assert.deepEqual(resp, [{"biz": "bar"}], "return .baz is correct");
        return index.query(find + 'return .baz.biz');
    }).then(resp => {
        assert.deepEqual(resp, ["bar"], "return .baz.biz is correct");
        return index.query(find + 'return .faz[1]');
    }).then(resp => {
        assert.deepEqual(resp, [{"biz": 5463}],
                         "return return .faz[1] is correct");
        return index.query(find + 'return .faz[1].biz');
    }).then(resp => {
        assert.deepEqual(resp, [5463], "return .faz[1].biz is correct");
        return index.query(find + 'return [.baz, .faz]');
    }).then(resp => {
        assert.deepEqual(resp, [[
            {"biz": "bar"},
            [{"fiz": 213}, {"biz": 5463}, {"biz": 73}]
        ]], "return [.baz, .faz] is correct");
        return index.query(find + 'return {baz: .baz, faz: .faz}');
    }).then(resp => {
        assert.deepEqual(resp, [{
            "baz": {"biz": "bar"},
            "faz": [{"fiz": 213}, {"biz": 5463}, {"biz": 73}]
        }], "return {baz: .baz, faz: .faz} is correct");
        return index.query(find + 'return .hammer default=0');
    }).then(resp => {
        assert.deepEqual(resp, [0], "return .hammer default=0 is correct");
        return index.query(find + 'return {baz: .baz default=0, hammer: .hammer default=1}');
    }).then(resp => {
        assert.deepEqual(resp, [{
            "baz": {"biz": "bar"},
            "hammer": 1
        }], "return {baz: .baz default=0, hammer: .hammer default=1} is correct");
        return index.query(find + 'return .faz[*].biz');
    }).then(resp => {
        assert.deepEqual(resp, [[5463, 73]], "return .faz[*].biz is correct");
        done()
    }).catch(error => {
        console.log(error);
    });
};

exports['test readme bind variables'] = function(assert, done) {
    var index = noise.open("readmebind", true);
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
    index.add([doc]).then(resp => {
        assert.deepEqual(resp, ["a"], "doc created");
        return index.query('find {foo: x::[{fiz: == "bar"}]} return x');
    }).then(resp => {
        assert.deepEqual(resp, [[{"fiz": "bar", "val": 4}]],
                         "return x is correct");
        return index.query('find {foo: x::[{fiz: == "bar"}]} return x.val');
    }).then(resp => {
        assert.deepEqual(resp, [[4]], "return x.val is correct");
        return index.query(
            'find {foo: x::[{fiz: == "bar"}], foo: y::[{fiz: == "baz"}]} return [x.val, y.val]');
    }).then(resp => {
        assert.deepEqual(resp, [[[4], [7]]],
                         "return [x.val, y.val] is correct");
        return index.query(
            'find {foo: x::[{fiz: == "bar"}], foo: y::[{fiz: == "baz"}]} return {x: x.val, y: y.val}');
    }).then(resp => {
        assert.deepEqual(resp, [{"x": [4], "y": [7]}],
                         "return {x: x.val, y: y.val} is correct");
        return index.query(
            'find {foo: x::[{fiz: == "baz"}] || bar: x::[{fiz: == "baz"}]} return {"x": x.val}')
    }).then(resp => {
        assert.deepEqual(resp, [{"x": [7, 9]}], "combined bind is correct");
        done();
    }).catch(error => {
        console.log(error);
    });
};

if (module == require.main) require('test').run(exports)
