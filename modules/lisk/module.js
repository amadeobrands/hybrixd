// (C) 2015 Internet of Coins / Metasync / Joachim de Koning
// hybridd module - lisk/module.js
// Module to connect to CryptoNote currencies like Monero/Bytecoin or any of their derivatives

// required libraries in this context
var fs = require('fs');
var Client = require('../../lib/rest').Client;

// exports
exports.init = init;
exports.tick = tick;
exports.exec = exec;
exports.stop = stop;
exports.link = link;
exports.post = post;

exports.delay = delay; // for testing only!

// initialization function
function init() {
	modules.initexec('lisk',['init']);
}

// stop function
function stop() {
}

// scheduled ticker function
function tick(properties) {
}

// standard functions of an asset store results in a process superglobal -> global.hybridd.process[processID]
// child processes are waited on, and the parent process is then updated by the postprocess() function
function exec(properties) {
	// decode our serialized properties
	var processID = properties.processID;
	var target = properties.target;
	var mode  = target.mode;
	var factor = (typeof target.factor != 'undefined'?target.factor:null);
	var fee = (typeof target.fee != 'undefined'?target.fee:null);
	var subprocesses = [];	
	var command = [];
	var postprocessing = true;
	// set request to what command we are performing
	global.hybridd.proc[processID].request = properties.command;
	// handle standard cases here, and construct the sequential process list
	switch(properties.command[0]) {
		case 'init':
      // set up REST API connection
      if(typeof target.user != 'undefined' && typeof target.pass != 'undefined') {
        var options_auth={user:target.user,password:target.pass};
        global.hybridd.asset[target.symbol].link = new Client(options_auth);
      } else { global.hybridd.asset[target.symbol].link = new Client(); }    
			// set up init probe command to check if Altcoin RPC is responding and connected
			subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/blocks/getStatus"]})');
			subprocesses.push('func("lisk","post",{target:'+jstr(target)+',command:["init"],data:data,data})');
      subprocesses.push('pass( (data != null && typeof data.success!="undefined" && data.success ? 1 : 0) )');      
      subprocesses.push('logs(1,"module lisk: "+(data?"connected":"failed connection")+" to ['+target.symbol+'] host '+target.host+'",data)');      
		break;
		case 'test':
      subprocesses.push('time(0)');
			subprocesses.push('wait(2000)');
			subprocesses.push('wait(2000)');
			subprocesses.push('func("lisk","delay",{target:'+jstr(target)+'})');
			subprocesses.push('wait(2000)');
			subprocesses.push('wait(2000)');
			subprocesses.push('wait(8000)');
			subprocesses.push('jump(-6)');
		break;
		case 'status':
			// set up init probe command to check if Altcoin RPC is responding and connected
			subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/loader/status/sync"]})'); // get sync status
      subprocesses.push('poke("liskA",data)');	                                                            // store the resulting data for post-process collage
			subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/blocks/getStatus"]})');   // get milestone / difficulty
      subprocesses.push('poke("liskB",data)');	                                                            // store the resulting data for post-process collage
			subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/peers/version"]})');      // get version
			subprocesses.push('func("lisk","post",{target:'+jstr(target)+',command:["status"],data:{liskA:peek("liskA"),liskB:peek("liskB"),liskC:data}})');       // post process the data
		break;    
		case 'factor':
      // directly relay factor, post-processing not required!
      subprocesses.push('stop(0,"'+factor+'")');     
		break;
		case 'fee':
      // directly relay factor, post-processing not required!
      subprocesses.push('stop(0,"'+padFloat(fee,factor)+'")');
		break;
    case 'balance':
      // define the source address/wallet
      var sourceaddr = (typeof properties.command[1] != 'undefined'?properties.command[1]:'');
      if(sourceaddr) {
        subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/accounts/getBalance?address='+sourceaddr+'"]})'); // send balance query
        subprocesses.push('stop((typeof data.balance!="undefined"?0:1),fromInt(data.balance,'+factor+'))');
      } else {
        subprocesses.push('stop(1,"Error: missing address!")');
      }      
		break;
		case 'push':
      var deterministic_script = (typeof properties.command[1] != 'undefined'?properties.command[1]:false);
      if(deterministic_script && typeof deterministic_script=='string') {
        subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:["api/blocks/getNetHash"]})'); // get the nethash to be able to send transactions
        subprocesses.push('func("lisk","link",{target:'+jstr(target)+',command:'+jstr(['peer/transactions',deterministic_script])+',nethash:data.nethash})'); // shoot deterministic script object to peer node
        subprocesses.push('stop((typeof data.success!="undefined" && data.success?0:1),(typeof data.transactionId!="undefined"?functions.clean(data.transactionId):"Transaction error or bad nethash!"))'); // shoot deterministic script object to peer node
      } else {
        subprocesses.push('stop(1,"Missing or badly formed deterministic transaction!")');
      }
    break;
		case 'unspent':
      subprocesses.push('stop(0,{"unspents":[],"change":"0"})');      
    break;
		case 'history':
      //if(typeof properties.command[1] != 'undefined') { if(properties.command[1] == 'pending') { var transfertype = 'unavailable' } else { var transfertype = 'available'; } } else { var transfertype = 'available'; }
      // /api/transactions?blockId=blockId&senderId=senderId&recipientId=recipientId&limit=limit&offset=offset&orderBy=field
      var sourceaddr = (typeof properties.command[1] != 'undefined'?properties.command[1]:'local');
      var limit = (typeof properties.command[2] != 'undefined'?'&limit='+properties.command[2]:'');
      var offset = (typeof properties.command[3] != 'undefined'?'&offset='+properties.command[3]:'');
      //var startdate = (typeof properties.command[1] != 'undefined'?properties.command[1]:(Date.now()-(86400*14)));
      //var enddate = (typeof properties.command[1] != 'undefined'?properties.command[1]:Date.now());
      var params = 'recipientId='+sourceaddr+limit+offset+'&orderBy=timestamp:desc';
      command = ['api/transactions?'+params];
      subprocesses.push('poke("sourceaddr","'+sourceaddr+'")');	// store the resulting data for post-process collage
      subprocesses.push('func("lisk","link",'+jstr({target,command})+')');
		break;
		default:
		 	subprocesses.push('stop(1,"Asset function not supported!")');
	}
  // fire the Qrtz-language program into the subprocess queue
  scheduler.fire(processID,subprocesses);
}
  
// standard function for postprocessing the data of a sequential set of instructions
function post(properties) {
	// decode our serialized properties
	var processID = properties.processID
	var target = properties.target
	var postdata = properties.data;
	var factor = (typeof target.factor != 'undefined'?target.factor:null);
	// set data to what command we are performing
	global.hybridd.proc[processID].data = properties.command;
	// handle the command
	if (postdata == null) {
		var success = false;
	} else {
		var success = true;
		switch(properties.command[0]) {
      case 'init':
        // set asset fee for Lisk transactions
        if(typeof postdata.fee!='undefined' && postdata.fee) {
          global.hybridd.asset[target.symbol].fee = fromInt(postdata.fee,factor);
        }
      break;
			case 'status':
        // nicely cherrypick and reformat status data
        var collage = {};
        collage.module = 'lisk';
        collage.synced = null;
        collage.blocks = null;
        collage.supply = null;
        collage.difficulty = null;
        collage.testmode = 0;
        collage.version = (typeof postdata.liskC.version != 'undefined' ? String(postdata.liskC.version+' (build '+(typeof postdata.liskC.build != 'undefined'?postdata.liskC.build.rTrim("\n"):'?')+')') : null);
        if(postdata.liskA != null) {
          if(typeof postdata.liskA != 'undefined') {
            collage.synced = (typeof postdata.liskA.blocks != 'undefined'	? (postdata.liskA.blocks ? 0 : 1) : null);
            collage.blocks = (typeof postdata.liskA.height != 'undefined'	? postdata.liskA.height : null);
            // ADD blocktime
          }
          if(typeof postdata.liskB != 'undefined') {
            //collage.fee = (typeof postdata.liskB.fee != 'undefined'	? postdata.liskB.fee : null);
            collage.supply = (typeof postdata.liskB.supply != 'undefined'	? postdata.liskB.supply : null);							
            collage.difficulty = (typeof postdata.liskB.milestone != 'undefined' ? postdata.liskB.milestone : null);
          }
        }
        postdata = collage;
			break;
			default:
				success = false;		
		}
	}
  // stop and send data to parent
  scheduler.stop(processID,{err:(success?0:1),data:postdata});
}

// DEPRECATED: standard function for postprocessing the data of a sequential set of instructions
function postOLD(properties) {
	// decode our serialized properties
	var processID = properties.processID
	var procinfo = scheduler.procpart(properties.processID);
	var parentID = procinfo[0];
	var prevproc = procinfo[2];
	var target = properties.target;
	var factor = (typeof properties.factor != 'undefined'?properties.factor:12);
	var type  = (typeof properties.type != 'undefined'?properties.type:'deterministic');	
	var postvars = global.hybridd.proc[parentID].vars;
	var postdata = global.hybridd.proc[prevproc].data;
	// set data to what command we are performing
	global.hybridd.proc[processID].data = properties.command;
	// handle the command
	if (postdata == null) {
		var success = false;
	} else {
		var success = true;
		switch(properties.command[0]) {
			case 'status':
				if (typeof postdata.success != 'undefined') {
					// nicely cherrypick and reformat status data
					var collage = {};
					collage.module = 'lisk';
					if(postvars != null) {
						if(typeof postvars.liskA != 'undefined') {
							collage.synced = (typeof postvars.liskA.blocks != 'undefined'	? (postvars.liskA.blocks ? 0 : 1) : null);
							collage.blocks = (typeof postvars.liskA.height != 'undefined'	? postvars.liskA.height : null);
							// ADD blocktime
						}
						if(typeof postvars.liskB != 'undefined') {
							collage.fee = (typeof postvars.liskB.fee != 'undefined'					? postvars.liskB.fee : null);
							collage.supply = (typeof postvars.liskB.supply != 'undefined'			? postvars.liskB.supply : null);							
							collage.difficulty = (typeof postvars.liskB.milestone != 'undefined'	? postvars.liskB.milestone : null);
						}
						collage.testmode = 0;   // Lisk always runs realnet?
					} else {
						collage.synced = null;
						collage.blocks = null;
						collage.fee = null;
						collage.supply = null;
						collage.difficulty = null;
						collage.testmode = null;
					}
					collage.version = (typeof postdata.version != 'undefined' ? String(postdata.version+' (build '+(typeof postdata.build != 'undefined'?postdata.build.rTrim("\n"):'?')+')') : null);
					postdata = collage;
					// on init, report back to stdout
					if(properties.command[1] == 'init') {
						console.log(' [i] module lisk: connected to ['+target.symbol+'] host '+target.host+':'+target.port);
					}
				} else {
					console.log(' [!] module lisk: failed connection to ['+target.symbol+'] host '+target.host+':'+target.port);
					global.hybridd.proc[parentID].err = 1;
				}		
			break;
			case 'balance':
				// if result is not a number, set the error flag!
				global.hybridd.proc[prevproc].err = 1;
        if(typeof postdata.success != 'undefined') {
          if(postdata.success) {
            // data returned looks like: {"success":true,"balance":"0","unconfirmedBalance":"0"}
            global.hybridd.proc[prevproc].err = 0;
            postdata = postdata.balance/Math.pow(10,factor);
          }
        }
			break;
			case 'transfer':
				global.hybridd.proc[prevproc].err = 1;
				if(typeof postdata.transactionId != 'undefined') {
					global.hybridd.proc[prevproc].err = 0;
					//postdata = functions.clean(postdata.result.tx_hash);
					postdata = functions.clean(postdata.transactionId);
				}
			break;
			case 'transferlist':
				global.hybridd.proc[prevproc].err = 1;
				if(typeof postdata.transactions != 'undefined') {
					if(typeof postdata.transactions == 'object') {
						global.hybridd.proc[prevproc].err = 0;
						var transactions = [];
						var cnt = 0;
						postdata.transactions.forEach(function(entry) {
							transactions.push({
								id:entry.id,
								amount:entry.amount/Math.pow(10,factor),
								send:(entry.senderId==sourceaddr?1:0),  // GET SOURCEADDR!
								txid:functions.clean(entry.blockId),
                time:entry.timestamp
							});
							cnt++;
						});
						postdata = transactions;
					}
				}
			break;
			default:
				success = false;		
		}
	}
  scheduler.stop(processID,{err:(success?1:0),data:postdata});
	// default is to transfer the datafield of the last subprocess to the main process
	if (success && !global.hybridd.proc[prevproc].err && typeof postdata != 'undefined') {
		if(DEBUG) { console.log(' [D] sending postprocessing data to parent '+parentID); }
    scheduler.stop(parentID,{err:0,data:postdata});
	} else {
		if(DEBUG) { console.log(' [D] error in '+prevproc+' during postprocessing for '+parentID); }
		postdata = (typeof postdata.error!='undefined'?postdata.error:null);
    scheduler.stop(parentID,{err:1,data:null});
	}
}

// data returned by this connector is stored in a process superglobal -> global.hybridd.process[processID]
function link(properties) {
	var target = properties.target;
  var base = target.symbol.split('.')[0];     // in case of token fallback to base asset
	var processID = properties.processID;
	var command = properties.command;
	if(DEBUG) { console.log(' [D] module lisk: sending REST call for ['+target.symbol+'] -> '+JSON.stringify(command)); }
	// separate method and arguments
	var method = command.shift();
	var params = command.shift();
  var args = {};
  // do a GET or PUT/POST based on the command input
  var type;
  if(typeof params!=='undefined') {
    if(typeof params==='string') { try { params = JSON.parse(params); } catch(e) {} }
    var nethash = (typeof properties.nethash!='undefined'?properties.nethash:'');
    var version = '0.9.9';
    if(method.substr(0,4)=='api/') {
      type='PUT';
      args = {
          headers:{'Content-Type':'application/json','version':version,'port':1,'nethash':nethash},
          data:JSON.stringify(params)
      }
      //var postresult = restAPI.put(queryurl,args,function(data,response){restaction({processID:processID,data:data});});
    } else {
      type='POST';
      args = {
          headers:{'Content-Type':'application/json','version':version,'port':1,'nethash':nethash},
          data:{'transaction':params}
      }
      // DEBUG: console.log(' ##### POST '+queryurl+' '+jstr(args)+' nh:'+nethash);
      //var postresult = restAPI.post(queryurl,args,function(data,response){restaction({processID:processID,data:data});});
    }
  } else {
    type = 'GET';
    args = { path:method }
  }
  
  // construct the APIqueue object
  APIqueue.add({ 'method':type,
                 'link':'asset["'+base+'"]',  // make sure APIqueue can use initialized API link
                 'host':(typeof target.host!=='undefined'?target.host:global.hybridd.asset[base].host),  // in case of token fallback to base asset hostname
                 'args':args,
                 'throttle':(typeof target.throttle!=='undefined'?target.throttle:global.hybridd.asset[base].throttle),  // in case of token fallback to base asset throttle
                 'pid':processID,
                 'target':target.symbol });  

}


// TESTING

// standard function for postprocessing the data of a sequential set of instructions
function delay(properties) {
	// decode our serialized properties
	var processID = properties.processID
	var target = properties.target
  var subprocesses=[];

			subprocesses.push('time(0)');
			subprocesses.push('wait(5000)');
			subprocesses.push('wait(5000)');
			subprocesses.push('wait(5000)');

  // fire the Qrtz-language program into the subprocess queue
  scheduler.fire(processID,subprocesses);
}
