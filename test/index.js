var noise = require('../lib/noise.js');

// if test function expects second named argument it will be executed 
// in async mode and test will be complete only after callback is called 
exports['test basic'] = function(assert, done) {
    var index = noise.open("firstrealtest", true);
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
        return noise.drop("firstrealtest");
    }).then(() => {
        assert.ok(true, "index dropped");
        done();
    }).catch(error => {
        console.log(error);
    });
}

exports['test iterable'] = function(assert, done) {
    var index = noise.open("iterabletesttest", true);
    index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]).then(resp => {
        assert.deepEqual(resp, ["a","b"], "docs created");
        return index.query('find {foo: =="bar" || foo: =="baz"}')
    }).then(iter => {
        let ids = [];
        for (let value of iter) {
            ids.push(value);
        }
        assert.deepEqual(ids, ["a", "b"], "doc a and b found");
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
    }).then(iter => {
        assert.equal(iter.next().value, "a", "found a on instance 2");
        assert.equal(iter.next().done, true, "done");
        return index2.close();
    }).then(() => {
        return index1.query('find {foo: == "bar"}')
    }).then(iter => {
        assert.equal(iter.next().value, "a", "found a on instance 1");
        assert.equal(iter.next().done, true, "done");
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
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: id}, "Empty document is possible");
        assert.equal(iter.next().done, true, "done");
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
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: id, foo: "bar"},
                         "Document without _id is possible");
        assert.equal(iter.next().done, true, "done");
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
    }).then(iter => {
        assert.deepEqual(iter.next().value, {_id: "a"},
                         "Document with _id only is returned correctly");
        assert.equal(iter.next().done, true, "done");
        done();
    }).catch(error => {
        console.log(error);
    });
};

if (module == require.main) require('test').run(exports)
