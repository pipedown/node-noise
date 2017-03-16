var noise = require('../lib/noise.js');

// if test function expects second named argument it will be executed 
// in async mode and test will be complete only after callback is called 
exports['test basic'] = function(assert, done) {
    var index;
    noise.open("firstrealtest", true).then((retIndex) => {
        assert.ok(retIndex, "index opened/created");
        index = retIndex;
        return index.add([{_id:"a",foo:"bar"}, {_id:"b", foo:"baz"}]);
    }).then((resp) => {
        assert.deepEqual(resp, ["a","b"], "docs created");
        return index.query('find {foo: =="bar"}')
    }).then((resp) => {
        assert.deepEqual(resp, ["a"], "doc a found");
        return index.delete(resp);
    }).then((resp) => {
        assert.deepEqual(resp, [true], "doc a deleted");
        return index.close();
    }).then(() => {
        assert.ok(true, "index closed");
        return noise.drop("firstrealtest");
    }).then(() => {
        assert.ok(true, "index dropped");
        done();
    }).catch((error) => {
        if (index) {
            index.close();
        }
        console.log("error: " + error);
    });
}
 
if (module == require.main) require('test').run(exports)
