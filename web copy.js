require('newrelic');
var express = require('express');
var bodyParser = require('body-parser');
var domain = require('domain');
var http = require('http');
var posix = require('posix');
var request = require('request');
// posix.setrlimit('nofile', { soft: 10000 });
/**
 * If configured as a cluster master, just start controller...
 */

//var Q = require('q');
//var crypto = require('crypto');
//var fs = require('fs');
var app = express();
var cryptohelper = require("./common/crypto.js");
var local_cache = require('memory-cache');
var config = require("./config/production_config");
if(process.env.OU_ENV == "qa" || process.env.OU_ENV == "dev"){
	config = require("./config/development_config");
}
var bonus_config = require('./config/bonus_config');
var accountservice = require("./services/accountservice");
var appservice = require("./services/appservice");
var spinservice = require("./services/spinservice");
var mobileappservice = require("./services/mobileappservice");
var userstatesservice = require("./services/userstatesservice.js");



var coin_ledger = require("./modules/coinledger/coinledgerservice");
var eventviewer = require("./modules/analytics/eventviewer")
var linkbombservice = require("./modules/linkbomb/feed_provider");
var linkbombtestservice = require("./modules/linkbomb/feed_provider_test");

var payment_state_handle = require('./rest_handler/payment_state_handle.js')
var slot_machine_handle = require('./rest_handler/slot_machine_handle');
var purchase_verification_handle = require('./rest_handler/purchase_verification_handle');
var facebook_realtimeupdate_handle = require('./rest_handler/facebook_realtimeupdate_handle');
var spin_handle = require('./rest_handler/spin_handle');
var login_handle = require('./rest_handler/login_handle');
var client_logging_handle = require('./rest_handler/client_logging.js');
var gift_service_handle = require('./rest_handler/gift_service_handle.js');
var config_handle = require('./rest_handler/app_configuration_handle.js');
var user_states_handle = require('./rest_handler/user_states_handle.js');
var event_log_handle = require('./rest_handler/eventlogs_handle.js');
var dialogs_handle = require('./rest_handler/dialogs_handle.js');
var game_unit_converter = require('./rest_handler/game_unit_converter.js');
var wlphandler = require('./rest_handler/wlp_purchase_handle.js');
var s3assethandler = require('./rest_handler/s3_asset_handle.js');
var html2jsonhandle = require("./rest_handler/html2json_handle.js");
var tapjoy_handle = require('./rest_handler/tapjoy_handle.js');

var node_port = process.env.PORT || 5889;// Used for connecting to the math engine

var workerId = function() {
    if(cluster.isWorker) {
        return cluster.worker.id;
    }
    return 'NON-CLUSTERED WORKER ???';
}

var SECRET_DELTA_KEY=8;

app.use(express.static(__dirname + "/public"));
app.use(bodyParser.urlencoded({
	extended:true
}));
app.use(bodyParser.json());

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.set('view engine', 'jade');

app.use(function(req, res, next) {
    var d = domain.create();
    d.on('error', next);
    d.add(req);
    d.add(res);
    d.run(next);
});

//add the router after the domain middleware
//app.use(app.router);

var bonusConfig = null;
var updateBonusConfig = function() {
    mobileappservice.getBonusConfig(function(result) {
        if(result) {
            bonusConfig = result;
        }
    });
}

////To print any redshift table schema 
//var pg = require("./models/rsschema.js");
//console.log("Q:",pg.getIAPLog().buildCreateQuery())

setTimeout(updateBonusConfig,500);//Shoot in with few milliseconds delay.
setInterval(updateBonusConfig,config.BONUS_CONFIG_CACHE_EXPIRE);

app.get('/echo',function(req,res){	
	res.json({headers:req.headers,params:req.params});
});

app.post('/echo',function(req,res){
	console.log("/echo data",req.body);
	res.json({headers:req.headers,body:req.body});
});

app.get('/get_bonus_config', function(req, res) {
    // for debugging
    output = {}
    output['success'] = true;
    output['bonus_config'] = bonusConfig;
    res.json(output);
});

//express error handler ..
//which will catch domain errors and respond nicely with a 500
//after the response, it will disconnect this worker gracefully
//meaning no more connections will be accepted and once the
//error connection terminates, the worker will die
app.use(function(err, req, res, next) {
	try{
		console.log('Route error. ' + err);
		console.log('Route error stack: ' + err.stack);
	}catch(e){}
    res.send(500, ' request error');
});

app.get('/get_apps',function(req,res){
	res.send(mobileappservice.getAllApps());
})

////S3 assets service
app.post('/copyAssets',function(req,resp){
	console.log("/copyAssets data:",req.body);
	s3assethandler.copyAssets(req,resp);
});

////CSV converter
app.get('/getGameUnit',function(req,resp){
	game_unit_converter.getGameUnit(req,resp);
});

////Verify payment handler routing
app.post('/verify_payment', function(req, res) {
	purchase_verification_handle.verify_payment(req.body, req, res);
});

app.get('/verify_payment', function(req, res) {
	purchase_verification_handle.verify_payment(req.query, req, res);
});

app.get('/pending_fb_transactions',function(req,res){
	purchase_verification_handle.checkFBCoinCreditedForPendingReceipts(req,res);
});

////Fb realtime updates
app.get('/fb_update', function(req, res) {
	facebook_realtimeupdate_handle.updateSetup(req, res);
});

app.post('/fb_update', function(req, res) {
	facebook_realtimeupdate_handle.updateRealtime(req, res);
});


///HTML to json for web apps
app.get('/html_json',function(req,res){
	html2jsonhandle.htmltojson(req,res);
});

////////payment states logging//////////

app.post('/update_payment_transaction',function(req,res){
	payment_state_handle.handleUpdatePayementTransaction(req,res);
});

app.post('/payment_transaction_error',function(req,res){
	payment_state_handle.handlePaymentTransactionError(req,res);
});


////WLP purchase APIs
app.post('/wlp_purchase',function(req,res){
	console.log("/wlp_purchase data",req.body);
	return wlphandler.wlp_purchase(req,res);
});

////Dialog APIs
app.get('/get_dialog_list',function(req,res){
	dialogs_handle.getDialogList(req,res);
});

app.get('/get_all_dialogs',function(req,res){
	dialogs_handle.getAllDialogs(req,res);
});

app.post('/get_dialogs',function(req,res){
	console.log("/get_dialogs data",req.body);
	dialogs_handle.getDialogs(req,res);
});

//////Slot machine handler routing
app.post('/get_favorite_slots', function(req, res) {
	console.log("get_favorite_slots data",req.body);
	slot_machine_handle.get_favorite_slots(req, res);
});

app.post('/get_friend_favorite_slots', function(req, res) {
	slot_machine_handle.get_friend_favorite_slots(req, res);
});

app.post('/set_favorite_slots', function(req, res) {
	console.log("set_favorite_slots data",req.body);
	slot_machine_handle.set_favorite_slots(req, res);
});

app.post('/mag7_login',login_handle.mag7_login);

app.post('/login_device',login_handle.login_device);

app.post('/login_web',login_handle.login_web);

app.post('/login_device_social',login_handle.login_device_social);

app.post('/register_with_email',login_handle.register_with_email);

app.post('/login_email',login_handle.login_with_email);

app.post('/forget_password',login_handle.forgot_password);

/////TAPJOY APIs/////

app.get('/tapjoy_callback/:real_package_name', tapjoy_handle.tapjoy_callback);

////////Game_server API handles//////////

app.get('/get_regen_bonus', gift_service_handle.get_regen_bonus);

app.get('/get_gift_items', gift_service_handle.get_gift_items);

//app.post('/send_gift_items', gift_service_handle.send_gift_items_post);
//
//app.get('/send_gift_items', gift_service_handle.send_gift_items_get);

app.get('/send_gifts',gift_service_handle.send_gift_items_by_fbids_get);

app.post('/send_gifts',gift_service_handle.send_gift_items_by_fbids_post);

app.get('/get_recent_gift_send_list',gift_service_handle.getFBFriendsToUserSentGiftToday);

app.post('/collect_gifts', gift_service_handle.reset_gift_items_post);

app.get('/collect_gifts', gift_service_handle.reset_gift_items_get);

app.get('/get_fb_users_for_gifting', gift_service_handle.get_fb_users_for_gifting_get);

app.post('/get_fb_users_for_gifting', gift_service_handle.get_fb_users_for_gifting_post);

app.post('/send_gift_request', gift_service_handle.send_gift_request);

//app.post('/get_fb_users', gift_service_handle.get_fb_users);

//app.post('/get_fb_user_data',gift_service_handle.get_fb_user_data_post);

//app.get('/get_fb_user_data',gift_service_handle.get_fb_user_data_get);

////////payment states logging//////////

app.post('/update_payment_transaction',function(req,res){
	var user_id = req.body['user_id'];
	var package_name = req.body['package_name'];
	var state = parseInt(req.body['state']);
	var ustate = req.body['ustate'];
	var payment_id = req.body['payment_id'];
	var payment_obj = req.body['payment_obj'];
	try{
		payment_obj = JSON.stringify(payment_obj);
	}catch(e){}
	var receipt = req.body['receipt'];
	try{
		receipt = JSON.stringify(receipt);
	}catch(e){};
	console.log("Payment_log - RID:" + req.headers['x-request-id'] + " user_id:" + user_id + " pkg:" + package_name + " state: " + state + " ustate:" +
			ustate + " payment_id:" + payment_id + " payment_obj:" + payment_obj + " receipt: " + receipt);
	res.send({"success":true});
});

app.post('/payment_transaction_error',function(req,res){
	var user_id = req.body['user_id'];
	var package_name = req.body['package_name'];
	var state = parseInt(req.body['state']);
	var ustate = req.body['ustate'];
	var payment_id = req.body['payment_id'];
	var message = req.body['message'];
	var receipt = req.body['receipt'];
	try{
		receipt = JSON.stringify(receipt);
	}catch(e){};
	console.log("Payment_error_log - RID:" + req.headers['x-request-id'] + " user_id:" + user_id + " pkg:" + package_name + " state: " + state + " ustate:" +
			ustate + " payment_id:" + payment_id + " message:" + message + " receipt: " + receipt);
	res.send({"success":true});
});


////////////////////////////

//app.post('/get_pending_payments_transactions',function(req,res){
//	payment_log_handle.get_all_pending_payments(req,res);
//});
//
//app.post('/log_drop_payment',function(req,res){
//	payment_log_handle.log_drop_payment(req,res);
//});

////////Client rqst fail logging
app.post('/client_rqst_log', function(req, res) {
	client_logging_handle.handle_rqst_log(req,res);
});

////////App configurations
app.get('/get_config',config_handle.get_Config);

////////Build configurations
app.get('/get_build_config',config_handle.get_build_config);

/////////////user_states APIs///////////////

app.get("/get_states_user_params",function(req,res){
	user_states_handle.handle_get_states_user_params(req,res);
});
		
app.post("/update_states_user_params",function(req,res){
	console.log("/update_states_user_params data:",req.body);
	user_states_handle.handle_update_states_user_params(req,res);
});

app.get("/get_states_blob",function(req,res){
	user_states_handle.handle_get_states_blob(req,res);
});
		
app.post("/update_states_blob",function(req,res){
	console.log("/update_states_blob data:",req.body);
	user_states_handle.handle_update_states_blob(req,res);
});

app.get("/get_states_completed_missions",function(req,res){
	user_states_handle.handle_get_mission_completed(req,res);
});
		
app.post("/update_states_completed_missions",function(req,res){
	console.log("/update_states_completed_missions data:",req.body);
	user_states_handle.handle_update_mission_completed(req,res);
});

app.get('/get_piggy_bank_balance',function(req,res){
	console.log("/get_piggy_bank_balance");
	user_states_handle.handle_get_piggy_bank_balance(req,res);
});

/**** Archived ****/
//app.get("/get_states_game_levels",function(req,res){
//user_states_handle.handle_get_states_game_levels(req,res);
//});
//	
//app.post("/update_states_game_levels",function(req,res){
//console.log("/update_states_game_levels data:",req.body);
//user_states_handle.handle_update_states_game_levels(req,res);
//});


//////////////////////////
app.post("/event_log",function(req,res){
	//console.log("/event_log data:",req.body);
	event_log_handle.postAppEvent(req,res);
})

/////////////////////////

app.post('/update_user_state', function(req, res) {
    console.log("/update_user_state data: " + JSON.stringify(req.body));
    var package_name = appservice.cleanPackage(req.body.package_name);
    var user_id = req.body.user_id;
    accountservice.update_user_states(user_id,req.body,function(err){
        if(err){
            res.send('{"game_result":{"error_code":"update_user_state error, unable to update user_games for user","success":false}}');
        }else{
            res.send('{"game_result":{"success":true}}');
        }
    });
});

app.post('/update_facebook_email', function(req, res) {
    //console.log("req : " + JSON.stringify(req.body));
    var user_id = req.body.user_id;
    var fb_primary_email = req.body.fb_primary_email;
    console.log("/update_facebook_email data: " + JSON.stringify(req.body));

    accountservice.get_user_by_user_id(user_id, function (user){
        if(!user)
            return res.send(JSON.stringify({success:"False", error_msg:"Invalid user id"}));
        else
        {
            var data_to_update = {
                "facebook_primary_email": fb_primary_email
            };
            user.updateAttributes(data_to_update, function(err, result) {
                if (!err && result.errors == false) {
                    res.send('{"game_result":{"success":true}}');
                } else {
                    res.send('{"game_result":{"error_code":"update_facebook_email error, unable to update user","success":false}}');
                }
            })
        }
    });
});

function makeInt(input){
	if(input && !isNaN(input)){
		return parseInt(input);
	}
	return 0;
}

app.post('/add_user_coins', function(req, res) {
    //console.log("req : " + JSON.stringify(req.body));
	var real_package_name = req.body.name;
    var package_name = appservice.cleanPackage(req.body.name);
    if(!package_name){
    	package_name = req.body.name;
    }
    var user_id = req.body.user_id;
    var amount = parseInt(req.body.awarded_coins);
    var currency = req.body.currency;
    var platform = appservice.platform_name_from_package(real_package_name);
    var transaction_type = req.body.transaction_type;
    console.log("/add_user_coins data: " + JSON.stringify(req.body));

    // Check if the data has been compromised. Possible report/email to a supervisor
    // We can add some padding to the end of the hash to generate different values each time
    var expected_result = package_name + ';' + user_id + ';' + amount + ';';
//    if (!req.body.hash ||
//        cryptohelper.decodeAlphaNum(req.body.hash, SECRET_DELTA_KEY).indexOf(expected_result) == -1)
    // return res.send('{"game_result":{"error_code":"add_user_coins error, data has been tampered","success":false}}');

        accountservice.get_user_game(package_name, user_id, function (user_game){
            if (user_game == null) {
                res.send('{"game_result":{"error_code":"add_user_coins error, user not found","success":false}}');
            } else if(!currency || currency == 'coins'){
                var start_bal = user_game["coin_balance"];
            	var new_coin_balance = user_game["coin_balance"] + makeInt(amount);
                var data_to_update = {
                    "coin_balance": new_coin_balance
                };
                if(transaction_type == coin_ledger.TT_BOT && !user_game.is_bot){
                	return res.send('{"game_result":{"error_code":"add_user_coins error, unable to update user_games for coin_balance","success":false}}');
                }
                user_game.updateAttributes(data_to_update, function(err, result) {
                    if (!err && result.errors == false) {
                        res.send('{"game_result":{"coins":'+new_coin_balance +
                        		',"loyalty_points":' + makeInt(user_game["loyalty_points"]) + '}}');
                        coin_ledger.add_coin_transaction(user_game,real_package_name,
                            transaction_type,start_bal,new_coin_balance,function(err){
                        });
                    } else {
                        return res.send('{"game_result":{"error_code":"add_user_coins error, unable to update user_games for coin_balance","success":false}}');
                    }
                });
            }else if(currency == 'loyalty_points'){
            	var start_bal = makeInt(user_game["loyalty_points"]);
            	var new_loyalty_points = start_bal + makeInt(amount);
                var data_to_update = {
                    "loyalty_points": new_loyalty_points
                }; 
                user_game.updateAttributes(data_to_update, function(err, result) {
                    if (!err && result.errors == false) {
                        res.send('{"game_result":{"coins":'+user_game["coin_balance"] +
                        		',"loyalty_points":' + new_loyalty_points + '}}');
                        coin_ledger.add_coin_transactionLP(user_game,real_package_name,
                            transaction_type,start_bal,new_loyalty_points,function(err){
                        });
                    } else {
                        return res.send('{"game_result":{"error_code":"add_user_coins error, unable to update user_games for coin_balance","success":false}}');
                    }
                });                
            }
        });
});


app.get('/get_gamestate_info/:package_name/:game_name/:user_id', function(req, resp) {
	console.log('get_gamestate_info');
	accountservice.get_gamestate_info(req.params.user_id,appservice.cleanPackage(req.params.package_name),
			req.params.game_name,function(result){
		resp.send(result);
	});
});



/*****************************************
 Stringify the response for output
 ******************************************/
function _stringify(response, data)
{
    response.setHeader('Content-Type', 'application/json');
    return JSON.stringify(data, null, 3);
}



app.get('/user/:user_id/:packageName', function (req, res) {
    var package_name = accountservice.appservice(req.params.packageName);
    var user_id = req.params.user_id;
    accountservice.get_user_game(package_name, user_id, function (user_game){
        if (user_game == null) {
            res.send('{"game_result":{"error_code":"user info error, user not found","success":false}}');
        } else {
            var output = {};
            output["coin_balance"] = user_game["coin_balance"];
            output["level"] = user_game["level"];
            output["xp_current_level"] = user_game["xp_current_level"];
            output["xp_total"] = user_game["xp_total"];
            res.send(JSON.stringify(output));
        }
    });
});

app.get('/gdf/:gdf/:device_id/:user_id/:package_name', function(req, res) {
    var user_id = "" + req.params.user_id;
    var gdf = req.params.gdf;
    var platform = req.params['device_id'].split("::")[0];
    var package_name = req.params.package_name;
    userstatesservice.updateGameLaunched(user_id,gdf,function(success){
    	if(!success){
    		console.log("/gdf error in updateGameLaunched");
    	}
    });    
    var path = appservice.gdfpath(package_name,platform,gdf);
    console.log("/gdf",package_name,path);
    res.redirect(path);
});

app.get('/corsgdf/:gdf/:device_id/:user_id/:package_name', function(req, res) {
    var user_id = "" + req.params.user_id;
    var gdf = req.params.gdf;
    var platform = req.params['device_id'].split("::")[0];
    var package_name = req.params.package_name;
    userstatesservice.updateGameLaunched(user_id,gdf,function(success){
    	if(!success){
    		console.log("/corsgdf error in updateGameLaunched");
    	}
    });    
    var path = appservice.gdfpath(package_name,platform,gdf);
    console.log("/corsgdf",package_name,path);
    req.pipe(request.get(path)).pipe(res);    
});

/******************************Link Bomb*************************************************************/
app.get('/all_feed',linkbombservice.get_all_feeds);
app.get('/ufeed/:user_id',linkbombservice.get_player_feeds);
app.get('/tfeed/:action',linkbombservice.get_action_feeds);
app.get('/pfeed/:platform',linkbombservice.get_platform_feeds);
app.get('/gfeed/:game_name',linkbombservice.get_game_feeds);
app.get('/wfeed',linkbombservice.get_wining_feeds);
app.get('/afeed/:package',linkbombservice.get_app_feeds);

/******************************Test stuff************************************************************/
var moment = require('moment');
app.get('/coin_ledger',function(req,res){
	var user_id = req.query['user_id'];
	var package_name = req.query['package_name'];
	if(user_id && package_name){
		coin_ledger.get_recent_transactions_player(user_id,package_name,function(err,rows){
			for(var i in rows){
				rows[i].date_created =  moment(rows[i].date_created).format("MMM-DD-YY hh:mm");
			}			
			res.render('users', {all:false, users: rows, detail:"Recent transaction of " + user_id });
		});
	}
	else{
		coin_ledger.get_recent_transactions(function(err,rows){
			for(var i in rows){
				rows[i].date_created =  moment(rows[i].date_created).format("MMM-DD-YY hh:mm");
			}			
			res.render('users', {all:true, users: rows, detail: "All recent transactions."});
		});
	}
});
app.get('/test_all_feed',linkbombtestservice.get_all_feeds);
app.get('/test_ufeed/:user_id',linkbombtestservice.get_player_feeds);
app.get('/test_tfeed/:action',linkbombtestservice.get_action_feeds);
app.get('/test_pfeed/:platform',linkbombtestservice.get_platform_feeds);
app.get('/test_gfeed/:game_name',linkbombtestservice.get_game_feeds);
app.get('/test_wfeed',linkbombtestservice.get_wining_feeds);
app.get('/test_afeed/:package',linkbombtestservice.get_app_feeds);

///analytics viewer
app.get('/event_logs',function(req,res){
	var type=req.query['type'];
	var user_id = req.query['user_id'];
	if(!type && !user_id){
		return res.render("event_logs");
	}
	eventviewer.get_recent_logs(type,user_id,function(err,rows){
		for(var i in rows){
			rows[i].date_created =  moment(rows[i].date_created).format("MMM-DD-YY hh:mm");
			if(rows[i].local_time){
				rows[i].local_time =  moment(rows[i].local_time).format("MMM-DD-YY hh:mm");
			}
		}
		if(user_id)
			res.render(type + '_events', {all:false, users: rows, detail:"Recent "+ type +" logs of " + user_id });
		else
			res.render(type + '_events', {all:true, users: rows, detail: "All recent " + type + " logs."});
	});
});

/*********************************** Spin calls ***********************************************/

app.get('/game_tournament_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played', 
		spin_handle.game_tournament_spin);

app.get('/game_tournament_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played/:tournament_id',
		spin_handle.game_tournament_spin_tid);

app.get('/tournament_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played/:tournament_id',
		spin_handle.tournament_spin);

var counter=0;
app.get('/spin_timeout/:package_name/:gdf/:user_id/:line_bet/:lines_played',function(req,resp){
	console.log("spin_timeout counter",counter);
	if(counter % 2 !=0){
		spin_handle.spin(req,resp);
	}
	counter++;
});

var counter1=0;
app.get('/spin_error/:package_name/:gdf/:user_id/:line_bet/:lines_played',function(req,resp){
	console.log("spin_error counter",counter1);
	if(counter1 % 2 !=0){
		spin_handle.spin(req,resp);
	}else{
		resp.send('{"game_result":{"error_code":"gdf_not_found","success":false}}');
	}
	counter1++;
});


app.get('/spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.spin);

app.get('/state_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.state_spin);

app.get('/p_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.p_spin);

////Test spins

app.get('/bingo_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.bingo_spin);

app.get('/freetest_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.freetest_spin);

app.get('/multitest_spin/:package_name/:gdf/:line_bet',spin_handle.multitest_spin);

app.get('/pre-chew/:package_name/:gdf',spin_handle.pre_chew);

app.get('/shark_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.shark_spin);

app.get('/bonus_spin/:package_name/:gdf/:user_id/:line_bet/:lines_played',spin_handle.bonus_spin);

app.get('/spin',spin_handle.spin_test);


/******************************************************************************************/

var web = http.createServer(app);

process.on('exit', function() {
    console.log('exit');
});

app.listen(node_port, function() {
    console.log("Mag7: web.js listening on " + node_port);
});

module.exports = web;

