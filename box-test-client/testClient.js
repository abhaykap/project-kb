var net = require('net');

var client = new net.Socket();

const box_server_ip = '127.0.0.1';
const box_server_port = 1338;
var lock_status = 0;

function sendMessage(msg){
	client.write(msg + "\n");
}

client.connect(box_server_port,box_server_ip , function() {
	console.log('Connected');
	sendMessage("*SCOR,OM,123456789123456,Q0,412,80,28");
	sendMessage("*SCOR,OM,123456789123456,H0,0,412,28,80,0");
	setInterval(function(){ sendMessage("*SCOR,OM,123456789123456,H0," + lock_status + ",412,28,80,0") }, 60*4*1000);
});

client.on('error',function(err){
	console.log("Connection error",err);
	client.destroy();
});

client.on('data', function(data) {
	var strData = data.toString('utf8');
	console.log('Received: ' + strData);
	if(strData.indexOf("R0") != -1){
		const st = strData.split(",")[4];
		sendMessage("*SCOR,OM,123456789123456,R0," + st + ",55,1234,1497689816");
	}else if(strData.indexOf("L0") != -1 && lock_status == 1){
		sendMessage("*SCOR,OM,123456789123456,L0,0,1234,1497689816");
		lock_status = 0;
	}else if(strData.indexOf("L1") != -1 && lock_status == 0){
		sendMessage("*SCOR,OM,123456789123456,L1,1,1234,1497689816,3");
		lock_status = 1;
	}
	// else if(strData.indexOf("L1") != -1){
	// 	sendMessage("*SCOR,OM,123456789123456,L1,0,1234,1497689816,3");
	// }
});

client.on('close', function() {
	console.log('Connection closed');
});