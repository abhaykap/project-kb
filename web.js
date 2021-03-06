
var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var domain = require('domain');
var fs = require('fs');
var proc = require('process');
var util = require('util');

const box = require('./box/box-server');
const node_port = 3001;

box.init();

var app = express();
app.use(bodyParser.urlencoded({
    extended:true
}));
app.use(bodyParser.json());
app.set('view engine', 'jade');
app.use(function(req, res, next) {
    var d = domain.create();
    d.on('error', next);
    d.add(req);
    d.add(res);
    d.run(next);
});


app.get('/', function(req, res) {
    // for debugging    
    res.json(box.getNearMeDevices());
});

app.get('/nearme', function(req, res) {
    // for debugging    
    res.json(box.getNearMe());
});


app.get('/lock/:id',function(req,res){
    res.json(box.lockBox(req.params.id));
});

app.get('/unlock/:id',function(req,res){
    res.json(box.unlockBox(req.params.id));
});

app.get('/logs',function(req,res){
    const exec = require('child_process').exec;
    var handle = exec('tail -n 50 debug.log', function callback(error, stdout, stderr){
        res.write(stdout);
    });  
    handle.unref();  
});

app.get('/restart',function(req,res){
    const exec = require('child_process').exec;
    console.log("restarting...")
    var handle = exec('pm2 restart 0', function callback(error, stdout, stderr){
        res.write(stdout);
    });  
    handle.unref();  
});


var log_file = fs.createWriteStream(__dirname + '/debug.log', {flags : 'a'});
log_file.write("------------------------" + new Date() + "-------------------" + '\n');
var log_stdout = process.stdout;

console.log = function(d) { //
  log_file.write(util.format(d) + '\n');
  log_stdout.write(util.format(d) + '\n');
};


var web = http.createServer(app);
process.on('exit', function() {
    console.log('exit');
});
app.listen(node_port, function() {
    console.log("Mag7: web.js listening on " + node_port);
});



