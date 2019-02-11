const net = require('net');
const moment = require('moment');

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
		config:{
			id:null,
			locked:-1,//1 locked, 0 unlocked
			voltage:-1,
			power:-1,
			signal:-1,
			charging:-1,		
			gps_valid:false,
			latitude:-1,
			longitude:-1,
			gps_accuracy:"0",
			altitude: "0M",
			gps_time:""
		},
		loggin_state:0,//0=not logged in,1=logged in
		locking_state:0,//0=idle, 1=in-porgress
		gps_state:0,//0=idle, 1=in-progress
		lock_timestamp:0,
		operation_key:null,
		last_cycling_time:"0",
		data:"",
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

	server.listen(3000, '127.0.0.1');

}



function receiveFromClient(socket,data){
	var cmap = clientMap[socket];
	log('Received: ' + data);
	log('cmap: ' + JSON.stringify(cmap));
	//0xFFFF*SCOS,OM,123456789123456,XX,DDD#<Wrap>
	var strData = cmap.data + data.toString('utf8');
	while((idx = strData.indexOf("\n")) != -1){
		log("idx "+idx);
		const chunk = strData.substring(0,idx-1);//TODO assming # is part of end of message: <#\n>
		log("chunk " + chunk);
		processResponse(socket,chunk);
		strData = strData.substring(idx+1);
	}
}

function calcLatitude(lat,hemi){
	const deg = parseFloat(lat.substring(0,2));
	var min = lat.substring(2);
	min = parseFloat(min)/60;
	lat = deg + min;
	if(hemi == 'N')
		return lat;
	return (lat * -1);
}

function calcLongitude(lon,hemi){
	const deg = parseFloat(lon.substring(0,3));
	var min = lon.substring(3);
	min = parseFloat(min)/60;
	lon = deg + min;
	if(hemi == 'E')
		return lon
	return (lon * -1);
}

function processResponse(socket,data){	
	log("processResponse" + data);
	var cmap = clientMap[socket];
	const msg_parts = data.split(',');
	const iType = msg_parts[3];
	switch(iType){
		case 'Q0'://*SCOR,OM,123456789123456,Q0,412,80,28#<LF>
		log("RECVD- Log request");
			cmap.vendor_code = msg_parts[1];
			cmap.config.id = msg_parts[2];
			cmap.config.voltage = msg_parts[4];
			cmap.config.power = msg_parts[5];
			cmap.config.signal = msg_parts[6];
		break;

		case 'H0'://*SCOR,OM,123456789123456,H0,0,412,28,80,0#<LF>
			log("RECVD-HeartBeep");
			cmap.config.locked = msg_parts[4];
			cmap.config.voltage = msg_parts[5];			
			cmap.config.signal = msg_parts[6];
			cmap.config.power = msg_parts[7];
			cmap.config.charging = msg_parts[8];
			log("cmap.config.gps_state",cmap.gps_state);
			if(cmap.gps_state == 0){
				startTracking(cmap.config.id);
			}
		break;

		case 'R0'://*SCOR,OM,123456789123456,R0,0,55,1234,1497689816#<LF>
			const operation=msg_parts[4]==1?"lock":"unlock";
			log("RECVD- init-" + operation);
			cmap.operation_key = msg_parts[5];
			if(operation == "lock"){
				socket.write(makeCommand(cmap,'LOCK'));
			}else{
				socket.write(makeCommand(cmap,'UNLOCK'));
			}
		break;

		case 'L0'://*SCOR,OM,123456789123456,L0,0,1234,1497689816#<LF>
			const unlock_result = msg_parts[4];//0 success, 1 fail, 2 key error
			log("RECVD- Unlock status: " + unlock_result);
			cmap.locking_state = 0;
			cmap.config.locked = 0;
			socket.write(makeCommand(cmap,'UNLOCK-CONFIRM'));
		break;

		case 'L1'://*SCOR,OM,123456789123456,L1,0,1234,1497689816,3#<LF> Response
			const lock_result = msg_parts[4];//0 success, 1 fail, 2 key error
			log("RECVD- Lock status: " + lock_result);
			cmap.locking_state = 0;
			cmap.config.locked = 1;
			cmap.last_cycling_time = msg_parts[7];
			socket.write(makeCommand(cmap,'LOCK-CONFIRM'));
		break;

		case 'W0'://*SCOR,OM,123456789123456,W0,1#<LF>			
			//alarm_type 1:Illegal movement alarm  2:Falling alarm  3:Low power alarm
			const alarm_type = msg_parts[4];
			log("RECVD- Alarm " + alarm_type);
			//TOdo not doing anything for alarm as of now
			socket.write(makeCommand(cmap,'ALRAM-RECEIVED'));
		break;

		case 'E0'://SCOR,OM,123456789123456,E0,1#<LF> Upload controller fault code
			const fault_code = msg_parts[4];
			log("RECVD- ERROR - Upload controller fault " + fault_code);
			socket.write(makeCommand(cmap,'FAULT-ACK'));			
			//
		break;

		case 'D1'://*SCOS,OM,123456789123456,D1,60
			const interval = msg_parts[4];
			cmap.gps_state = 1;
			log("RECVD- Tracking with: " + interval);
		break;

		case 'D0'://*SCOR,OM,123456789123456,D0,0,124458.00,A,2237.7514,N,11408.6214,E,6,0.21,151216,10,M,A#
			const gps_identifier = msg_parts[4];//0: Command acquisition positioning upload identifier 1: Position tracking upload positioning identifier
			log("RECVD- GPS " + gps_identifier);
			const gps_time = msg_parts[5];//UTC time, hhmmss
			const gps_valid = msg_parts[6]=='A'?true:false;
			if(gps_valid){
				try{					
					cmap.config.latitude = calcLatitude(msg_parts[7],msg_parts[8]);//ddmm.mmmm					
					cmap.config.longitude = calcLongitude(msg_parts[9],msg_parts[10]);
					cmap.config.gps_accuracy = msg_parts[11];
					const gps_date = msg_parts[12];//UTC date, hhmmss
					cmap.config.altitude = msg_parts[14] + msg_parts[15];
					const gps_tracking_mode = msg_parts[15];
					cmap.config.gps_time = moment().format("YYYY-MM-DD HH:mm:ssZZ");
					cmap.config.gps_valid = true;
				}catch(e){
					cmap.config.gps_valid = false;
					log("Excption processing gps: " + e);
				}
			}else{
				cmap.config.gps_valid = false;
				log("INVALID GPS Received: " + msg_parts[6])
			}
		break;		

	}
	if(cmap.config.id && !socketsById[cmap.config.id]){
		log("updating clientMapById for: " + cmap.config.id);
		socketsById[cmap.config.id] = socket;
	}
	log('cmap after: ' + JSON.stringify(cmap));
}

function makeCommand(cmap, command){
	var cmd = HEADER + "," +  cmap.vendor_code + "," + cmap.config.id + ",";
	switch(command){
		case 'INIT-LOCK'://*SCOS,OM,123456789123456,R0,0,20,1234,1497689816#<LF>
			log("SENDING- Initilizing lock");
			cmap.lock_timestamp = Math.floor(Date.now() / 1000);
			cmap.locking_state = 1;
			cmd = cmd + "R0,1,20," + USER_ID + "," + cmap.lock_timestamp;
		break;
		case 'LOCK'://*SCOS,OM,123456789123456,L1,55#<LF>
			log("SENDING- Locking");
			cmd = cmd + "L1," + cmap.operation_key;
		break;
		case 'LOCK-CONFIRM'://*SCOS,OM,123456789123456,L1#<LF>
			log("SENDING- Lock ack");
			cmd = cmd + "L1";
		break;	

		case 'INIT-UNLOCK'://*SCOS,OM,123456789123456,R0,0,20,1234,1497689816#<LF>
			log("SENDING- Initilizing un-lock");
			cmap.lock_timestamp = Math.floor(Date.now() / 1000);
			cmap.locking_state = 1;
			cmd = cmd + "R0,0,20," + USER_ID + "," + cmap.lock_timestamp;
		break;			
		case 'UNLOCK'://*SCOS,OM,123456789123456,L0,55,1234,1497689816#<LF>
			log("SENDING- Un-locking");
			cmd = cmd + "L0," + cmap.operation_key + "," + USER_ID + "," + cmap.lock_timestamp;
		break;
		case 'UNLOCK-CONFIRM'://*SCOS,OM,123456789123456,L0#<LF>
			log("SENDING- Un-lock ack");
			cmd = cmd + "L0";
		break;
		case 'ALRAM-RECEIVED'://*SCOS,OM,123456789123456,W0#<LF>
			log("SENDING- Alarm ack");
			cmd = cmd + "W0";
		break;
		case 'FAULT-ACK'://*SCOS,OM,123456789123456,E0#<LF>
			log("SENDING- FAULT-ACK");
			cmd = cmd + "E0";
		break;
		case 'START-TRACKING'://*SCOS,OM,123456789123456,D1,60#<LF>
			log("SENDING- START-TRACKING");
			cmd = cmd + "D1,30"; //TODO - make the interval variable
		break;
		case 'STOP-TRACKING'://*SCOS,OM,123456789123456,D1,60#<LF>
			log("SENDING- STOP-TRACKING");
			cmd = cmd + "D1,0"; 
		break;
		
	}
	return cmd + "#\n";
}

module.exports.lockBox = function(id){	
	var socket = socketsById[id];
	if(!socket){
		log("lock error: client not logged in: " + id);
		return {success:false,status:"lock error: client not logged in: " + id};
	}
	const cmap = clientMap[socket];
	if(cmap.config.locked != 0){
		log("lock error: not unlocked: " + id);
		return {success:false,status:"lock error: not unlocked: " + id};
	}
	if(cmap.locking_state == 1){
		log("lock error: locking in-progress: " + id);
		return {success:false,status:"lock error: locking in-progress: " + id};
	}	
	socket.write(makeCommand(cmap,'INIT-LOCK'));
	return {success:true,status:"lock started"};
}

module.exports.unlockBox = function(id){
	var socket = socketsById[id];
	if(!socket){
		log("unlock error: client not logged in: " + id);
		return {success:false,status:"unlock error: client not logged in: " + id};
	}
	const cmap = clientMap[socket];
	if(cmap.config.locked != 1){
		log("unlock error: not locked: " + id);
		return {success:false,status:"unlock error: not locked: " + id};
	}
	if(cmap.locking_state == 1){
		log("unlock error: unlocking in-progress: " + id);
		return {success:false,status:"unlock error: unlocking in-progress: " + id};
	}
	socket.write(makeCommand(cmap,'INIT-UNLOCK'));
	return {success:true,status:"unlock started"};
}

function startTracking(id){
	log("startTracking");
	var socket = socketsById[id];
	if(!socket){
		log("GPS tracking error: client not logged in: " + id);
		return false;
	}
	const cmap = clientMap[socket];
	socket.write(makeCommand(cmap,"START-TRACKING"));
}

function disconnectFromClient(socket){
	log('box-server client disconnected');
	var cmap = clientMap[socket];
	if(cmap){		
		if(socketsById[cmap.config.id])
			delete socketsById[cmap.config.id];
		delete clientMap[socket];
	}
	socket.destroy();
}

module.exports.getNearMeDevices = function(){
	var boxes = [];
	for(k in clientMap){
		boxes.push(clientMap[k]);		
	}
	return boxes;
}

module.exports.getNearMe = function(){
	var boxes = [];
	for(id in clientMap){
		boxes.push(clientMap[id].config);
	}
	return boxes;
}


