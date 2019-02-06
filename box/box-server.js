var net = require('net');

const HEADER = String.fromCharCode(0XFF,0XFF) + '*SCOS';
const USER_ID = "1234";//TODO whats this for?


var clientMap = {};
var socketsById = {};

function log(str){
	console.log("BOX-SERVER:",str);
}

function BoxStateInit(){
	return {		
		vendor_code:null,
		id:null,
		config:{
			locked:-1,
			voltage:-1,
			power:-1,
			signal:-1,
			charging:-1,			
		},
		loggin_state:0,//0=not logged in,1=logged in
		locking_state:0,//0=idle, 1=in-porgress
		gps_state:0,//0=idle, 1=in-progress
		lock_timestamp:0,
		operation_key:null,
		last_cycling_time:"0",
	}
}

module.exports.init = function(){

	var server = net.createServer(function(socket) {
	    log("new client connect");
	    clientMap[socket] = BoxStateInit();
	    socket.on('end', function(){
	    	disconnectFromClient(socket);    		
  		});
	    socket.on('data',function(data) {	
	    	receiveFromClient(socket,data);
		});
	});

	server.on('error', (err) => {
		log("error: " + err);
  		throw err;
	});

	server.listen(1337, '127.0.0.1');

}


function receiveFromClient(socket,data){
	var cmap = clientMap[socket];
	log('Received: ' + data);
	log('cmap: ' + JSON.stringify(cmap));
	//0xFFFF*SCOS,OM,123456789123456,XX,DDD#<Wrap>
	var strData = data.toString('utf8');
	strData = strData.substring(0,strData.length-2) ;//remove new line TODO put -1
	log("received after: " +strData.length);
	//TODO should I remove # as well?
	const msg_parts = strData.split(',');
	const iType = msg_parts[3];
	switch(iType){
		case 'Q0'://*SCOR,OM,123456789123456,Q0,412,80,28#<LF>
			cmap.vendor_code = msg_parts[1];
			cmap.id = msg_parts[2];
			cmap.config.voltage = msg_parts[4];
			cmap.config.power = msg_parts[5];
			cmap.config.signal = msg_parts[6];
		break;

		case 'H0'://*SCOR,OM,123456789123456,H0,0,412,28,80,0#<LF>
			cmap.config.locked = msg_parts[4];
			cmap.config.voltage = msg_parts[5];			
			cmap.config.signal = msg_parts[6];
			cmap.config.power = msg_parts[7];
			cmap.config.charging = msg_parts[8];
		break;

		case 'R0'://*SCOR,OM,123456789123456,R0,0,55,1234,1497689816#<LF>
			const operation=msg_parts[4]==1?"lock":"unlock";
			log("operation: "+operation);
			cmap.operation_key = msg_parts[5];
			if(operation == "lock"){
				socket.write(makeCommand(cmap,'LOCK'));
			}else{
				socket.write(makeCommand(cmap,'UNLOCK'));
			}
		break;

		case 'L0'://*SCOR,OM,123456789123456,L0,0,1234,1497689816#<LF>
			const unlock_result = msg_parts[4];//0 success, 1 fail, 2 key error
			log("Unlock status received: " + unlock_result);
			cmap.locking_state = 0;
			cmap.config.locked = 0;
			socket.write(makeCommand(cmap,'UNLOCK-CONFIRM'));
		break;

		case 'L1'://*SCOR,OM,123456789123456,L1,0,1234,1497689816,3#<LF> Response
			const lock_result = msg_parts[4];//0 success, 1 fail, 2 key error
			log("Lock status received: " + lock_result);
			cmap.locking_state = 0;
			cmap.config.locked = 1;
			cmap.last_cycling_time = msg_parts[7];
			socket.write(makeCommand(cmap,'LOCK-CONFIRM'));
		break;
	}
	if(cmap.id && !socketsById[cmap.id]){
		log("updating clientMapById for: " + cmap.id);
		socketsById[cmap.id] = socket;
	}
	log('cmap after: ' + JSON.stringify(cmap));
}

function makeCommand(cmap, command){
	var cmd = HEADER + "," +  cmap.vendor_code + "," + cmap.id + ",";
	switch(command){
		case 'INIT-LOCK':
			//*SCOS,OM,123456789123456,R0,0,20,1234,1497689816#<LF>
			cmap.lock_timestamp = Math.floor(Date.now() / 1000);
			cmap.locking_state = 1;
			cmd = cmd + "R0,1,20," + USER_ID + "," + cmap.lock_timestamp;
		break;
		case 'UNLOCK':
			//*SCOS,OM,123456789123456,L0,55,1234,1497689816#<LF>
			cmd = cmd + "L0," + cmap.operation_key + "," + USER_ID + "," + cmap.lock_timestamp;
		break;
		case 'UNLOCK-CONFIRM':
			//*SCOS,OM,123456789123456,L0#<LF>
			cmd = cmd + "L0";
		break;
		case 'LOCK':
			//*SCOS,OM,123456789123456,L1,55#<LF>
			cmd = cmd + "L1," + cmap.operation_key;
		break;
		case 'LOCK-CONFIRM':
			//*SCOS,OM,123456789123456,L1#<LF>
			cmd = cmd + "L1";
		break;
	}
	return cmd + "\n";
}

function lockBox(id){	
	var socket = socketsById[id];
	if(!socket){
		log("lock error: client not logged in: " + id);
		return false;
	}
	const cmap = clientMap[socket];
	if(cmap.locking_state == 1){
		log("lock error: locking in-progress: " + id);
		return false;
	}
	cmap.socket.write(makeCommand(cmap,'INIT-LOCK'));
}

function disconnectFromClient(socket){
	log('box-server client disconnected');
}




