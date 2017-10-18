// (C) 2015 Internet of Coins / Metasync / Joachim de Koning
// hybridd module - ethereum/module.js
// Module to connect to ethereum or any of its derivatives

// required libraries in this context
var fs = require('fs');
var Client = require('../../lib/rest').Client;
var functions = require('../../lib/functions');

// exports
exports.init = init;
exports.tick = tick;
exports.exec = exec;
exports.stop = stop;
exports.link = link;
exports.post = post;

// initialization function
function init() {
  modules.initexec('ethereum',['init']);
}

// stop function
function stop() {
}

// scheduled ticker function
function tick(properties) {
}

// standard functions of an asset store results in a process superglobal -> global.hybridd.process[processID]
// child processes are waited on, and the parent process is then updated by the postprocess() function
// http://docs.ethereum.org/en/latest/protocol.html
function exec(properties) {
	// decode our serialized properties
	var processID = properties.processID;
	var target = properties.target;
  var base = target.symbol.split('.')[0];     // in case of token fallback to base asset
	var mode  = target.mode;
	var factor = (typeof target.factor != 'undefined'?target.factor:null);
	var subprocesses = [];	
	// set request to what command we are performing
	global.hybridd.proc[processID].request = properties.command;
  // define the source address/wallet
  var sourceaddr = (typeof properties.command[1] != 'undefined'?properties.command[1]:false);
	// handle standard cases here, and construct the sequential process list
	switch(properties.command[0]) {
		case 'init':
      if(!isToken(target.symbol)) {
        // set up REST API connection
        if(typeof target.user != 'undefined' && typeof target.pass != 'undefined') {
          var options_auth={user:target.user,password:target.pass};
          global.hybridd.asset[target.symbol].link = new Client(options_auth);
        } else { global.hybridd.asset[target.symbol].link = new Client(); }
        // initialize deterministic code for smart contract calls
        var dcode = String(fs.readFileSync('../modules/deterministic/ethereum/deterministic.js.lzma'));
        global.hybridd.asset[target.symbol].dcode = functions.activate( LZString.decompressFromEncodedURIComponent(dcode) );
        // set up init probe command to check if RPC and block explorer are responding and connected
        subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_gasPrice"]})');
        subprocesses.push('func("ethereum","post",{target:'+jstr(target)+',command:["init"],data:data,data})');
        subprocesses.push('pass( (data != null && typeof data.result=="string" && data.result[1]=="x" ? 1 : 0) )');      
        subprocesses.push('logs(1,"module ethereum: init "+(data?"connected":"failed connection")+" to ['+target.symbol+'] host '+target.host+'")');      
      }
		break;
		case 'status':
			// set up init probe command to check if Altcoin RPC is responding and connected
			subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_protocolVersion"]})');
			subprocesses.push('func("ethereum","post",{target:'+jstr(target)+',command:["status"],data:data})');
		break;
		case 'factor':
      // directly return factor, post-processing not required!
      subprocesses.push('stop(0,"'+factor+'")');
		break;
		case 'fee':
      // directly return fee, post-processing not required!
      if(!isToken(target.symbol)) {
        var fee = (typeof target.fee!='undefined'?target.fee:null);
      } else {
        var fee = (typeof global.hybridd.asset[base].fee != 'undefined'?global.hybridd.asset[base].fee*1.5:null);
        factor = (typeof global.hybridd.asset[base].factor != 'undefined'?global.hybridd.asset[base].factor:null);
      }
      subprocesses.push('stop(('+jstr(fee)+'!=null && '+jstr(factor)+'!=null?0:1),'+(fee!=null && factor!=null?'"'+padFloat(fee,factor)+'"':null)+')');
		break;
		case 'balance':
      if(sourceaddr) {
        if(!isToken(target.symbol)) {
          subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_getBalance",["'+sourceaddr+'","latest"]]})'); // send balance query
        } else {
          var symbol = target.symbol.split('.')[0];
          // DEPRECATED: var encoded = '0x'+abi.simpleEncode('balanceOf(address):(uint256)',sourceaddr).toString('hex'); // returns the encoded binary (as a Buffer) data to be sent
          var encoded = global.hybridd.asset[symbol].dcode.encode({'func':'balanceOf(address):(uint256)','address':sourceaddr}); // returns the encoded binary (as a Buffer) data to be sent
          subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_call",[{"to":"'+target.contract+'","data":"'+encoded+'"},"pending"]]})'); // send token balance ABI query
        }
        subprocesses.push('stop((data!=null && typeof data.result!="undefined"?0:1),(data!=null && typeof data.result!="undefined"? fromInt(hex2dec.toDec(data.result),'+factor+') :null))');
      } else {
        subprocesses.push('stop(1,"Error: missing address!")');
      }
		break;
		case 'push':
      var deterministic_script = (typeof properties.command[1] != 'undefined'?properties.command[1]:false);
      if(deterministic_script) {
        subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_sendRawTransaction",["'+deterministic_script+'"]]})');
        // returns: { "id":1, "jsonrpc": "2.0", "result": "0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331" }
        subprocesses.push('stop((typeof data.result!="undefined"?0:1),(typeof data.result!="undefined"?data.result:null))');
      } else {
        subprocesses.push('stop(1,"Missing or badly formed deterministic transaction!")');
      }
    break;
		case 'unspent':
      if(sourceaddr) {
        subprocesses.push('func("ethereum","link",{target:'+jstr(target)+',command:["eth_getTransactionCount",["'+sourceaddr+'","pending"]]})');
        subprocesses.push('stop(0,{"nonce":hex2dec.toDec(data.result)})');      
      } else {
        subprocesses.push('stop(1,"Error: missing address!")');
      }
    break;
      //if(sourceaddr) {
      //  subprocesses.push('func("blockexplorer","exec",{target:'+jstr( modules.getsource(mode) )+',command:["unspent","'+sourceaddr+'"'+(properties.command[2]?',"'+properties.command[2]+'"':'')+']})');
      //} else {
      //}
    break;
		case 'history':
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
        if(typeof postdata.result!='undefined' && postdata.result) {
          global.hybridd.asset[target.symbol].fee = fromInt(hex2dec.toDec(postdata.result).times(21000),factor);
        }
      break;
			case 'status':
        // nicely cherrypick and reformat status data
        var collage = {};
        collage.module = 'ethereum';
        collage.synced = null;
        collage.blocks = null;
        collage.fee = null;
        collage.supply = null;
        collage.difficulty = null;
        collage.testmode = null;
        collage.version = (typeof postdata.result=='string' ? postdata.result : null);
        postdata = collage;
			break;
			default:
				success = false;		
		}
	}
  // stop and send data to parent
  scheduler.stop(processID,{err:(success?0:1),data:postdata});
}

// data returned by this connector is stored in a process superglobal -> global.hybridd.process[processID]
function link(properties) {
  var target = properties.target;
  var base = target.symbol.split('.')[0];     // in case of token fallback to base asset
  // decode our serialized properties
  var processID = properties.processID;
  var command = properties.command;
  if(DEBUG) { console.log(' [D] module ethereum: sending REST call to ['+target.symbol+'] -> '+JSON.stringify(command)); }
  // separate method and arguments
  //var mainpath = (typeof target.path == 'undefined'?'':'/'+target.path);
  var method = command.shift();
  var params = command.shift();
  // launch the asynchronous rest functions and store result in global.hybridd.proc[processID]
  // do a GET or PUT/POST based on the command input
  if(typeof params=='string') { try { params = JSON.parse(params); } catch(e) {} }
  var args = {
      headers:{'Content-Type':'application/json'},
      data:{"jsonrpc":"2.0","method":method,"params":params,"id":Math.floor(Math.random()*10000)}
  }
  // construct the APIqueue object
  APIqueue.add({ 'method':'POST',
                 'link':'asset["'+base+'"]',  // make sure APIqueue can use initialized API link
                 'host':(typeof target.host!='undefined'?target.host:global.hybridd.asset[base].host),  // in case of token fallback to base asset hostname
                 'args':args,
                 'throttle':(typeof target.throttle!='undefined'?target.throttle:global.hybridd.asset[base].throttle),  // in case of token fallback to base asset throttle
                 'pid':processID,
                 'target':target.symbol });
}

function isToken(symbol) {
  return (symbol.indexOf('.')!==-1?1:0);
}

function tokenABI() {
  return [
            {
              "constant": true,
              "inputs": [],
              "name": "name",
              "outputs": [
                {
                  "name": "",
                  "type": "string"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": false,
              "inputs": [
                {
                  "name": "_spender",
                  "type": "address"
                },
                {
                  "name": "_value",
                  "type": "uint256"
                }
              ],
              "name": "approve",
              "outputs": [
                {
                  "name": "success",
                  "type": "bool"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [],
              "name": "totalSupply",
              "outputs": [
                {
                  "name": "",
                  "type": "uint256"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": false,
              "inputs": [
                {
                  "name": "_from",
                  "type": "address"
                },
                {
                  "name": "_to",
                  "type": "address"
                },
                {
                  "name": "_value",
                  "type": "uint256"
                }
              ],
              "name": "transferFrom",
              "outputs": [
                {
                  "name": "success",
                  "type": "bool"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [],
              "name": "decimals",
              "outputs": [
                {
                  "name": "",
                  "type": "uint8"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [],
              "name": "version",
              "outputs": [
                {
                  "name": "",
                  "type": "string"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [
                {
                  "name": "_owner",
                  "type": "address"
                }
              ],
              "name": "balanceOf",
              "outputs": [
                {
                  "name": "balance",
                  "type": "uint256"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [],
              "name": "symbol",
              "outputs": [
                {
                  "name": "",
                  "type": "string"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": false,
              "inputs": [
                {
                  "name": "_to",
                  "type": "address"
                },
                {
                  "name": "_value",
                  "type": "uint256"
                }
              ],
              "name": "transfer",
              "outputs": [
                {
                  "name": "success",
                  "type": "bool"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": false,
              "inputs": [
                {
                  "name": "_spender",
                  "type": "address"
                },
                {
                  "name": "_value",
                  "type": "uint256"
                },
                {
                  "name": "_extraData",
                  "type": "bytes"
                }
              ],
              "name": "approveAndCall",
              "outputs": [
                {
                  "name": "success",
                  "type": "bool"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "constant": true,
              "inputs": [
                {
                  "name": "_owner",
                  "type": "address"
                },
                {
                  "name": "_spender",
                  "type": "address"
                }
              ],
              "name": "allowance",
              "outputs": [
                {
                  "name": "remaining",
                  "type": "uint256"
                }
              ],
              "payable": false,
              "type": "function"
            },
            {
              "inputs": [
                {
                  "name": "_initialAmount",
                  "type": "uint256"
                },
                {
                  "name": "_tokenName",
                  "type": "string"
                },
                {
                  "name": "_decimalUnits",
                  "type": "uint8"
                },
                {
                  "name": "_tokenSymbol",
                  "type": "string"
                }
              ],
              "type": "constructor"
            },
            {
              "payable": false,
              "type": "fallback"
            },
            {
              "anonymous": false,
              "inputs": [
                {
                  "indexed": true,
                  "name": "_from",
                  "type": "address"
                },
                {
                  "indexed": true,
                  "name": "_to",
                  "type": "address"
                },
                {
                  "indexed": false,
                  "name": "_value",
                  "type": "uint256"
                }
              ],
              "name": "Transfer",
              "type": "event"
            },
            {
              "anonymous": false,
              "inputs": [
                {
                  "indexed": true,
                  "name": "_owner",
                  "type": "address"
                },
                {
                  "indexed": true,
                  "name": "_spender",
                  "type": "address"
                },
                {
                  "indexed": false,
                  "name": "_value",
                  "type": "uint256"
                }
              ],
              "name": "Approval",
              "type": "event"
            },
          ];
}



/* CONTRACT CALL EXAMPLE:
 * 

[{"id":"89ce170e8b1cb351aa80ba7dd5497797","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xAf30D2a7E90d7DC361c8C4585e9BB7D2F6f15bc7","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a73213536834bcf2f5328597b921a4c2","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xaEc98A708810414878c3BCDF46Aad31dEd4a4557","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1e5b5094625845b1438f4d95d8f2e8dc","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x422866a8F0b032c5cf1DfBDEf31A20F4509562b0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2f08af363a8a33afa830465eb8b75245","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xD0D6D6C5Fe4a677D343cC433536BB717bAe167dD","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b38ec5ded93584940d11d5ce2622b96d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4470BB87d77b963A013DB939BE332f927f2b992e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f016b59ff0affb335fced7dfc5d4fcaf","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x27dce1ec4d3f72c3e457cc50354f1f975ddef488","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2f4795d327f804e0327aa563587fada6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEA610B1153477720748DC13ED378003941d84fAB","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"023cf46abad52e40e1363f8a37f1f6de","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x949bEd886c739f1A3273629b3320db0C5024c719","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"db6187a1a6fe438461abc1357f16b334","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x960b236A07cf122663c4303350609A66A7B288C0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"698d98c702e533f7bbe17fb0d2211277","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x23aE3C5B39B12f0693e05435EeaA1e51d8c61530","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8e2622a26774e0ef16ea86ead8df0860","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xAc709FcB44a43c35F0DA4e3163b117A17F3770f5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b3fef31be26200418206f5bc84a1b66f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xBA5F11b16B155792Cf3B2E6880E8706859A8AEB6","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"bbe42c1c020d9bb7cb249d544989aed6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xfec0cF7fE078a500abf15F1284958F22049c2C7e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"fde79a7bf0e7f9c336e045c19f4945b8","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x17052d51E954592C1046320c2371AbaB6C73Ef10","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4f7d6aaad571fcb1601adb0be5557bcf","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x78B7FADA55A64dD895D8c8c35779DD8b67fA8a05","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6c141353b8a16b80f9682616a38ce48e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xeD247980396B10169BB1d36f6e278eD16700a60f","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"340aa399f955c28b9d9a4acf4c368492","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0d88ed6e74bbfd96b831231638b66c05571e824f","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"87bfabe567dd2b5c28b78a83c3200211","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0D8775F648430679A709E98d2b0Cb6250d2887EF","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f43d4da39f42b1bd424610223e690bf0","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1e797Ce986C3CFF4472F7D38d5C4aba55DfEFE40","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"328f9fd26d7a337e48004ac9084df6d6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x74C1E4b8caE59269ec1D85D3D4F324396048F4ac","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"cbaf14e6ea50e03c02a0e657666777e7","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x725803315519de78D232265A8f1040f054e70B98","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"829ce8b608929de3eebe92729e7a01f3","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xb2bfeb70b903f1baac7f2ba2c62934c7e5b974c4","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4dd8152e506578ce4617484c840e06ad","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xce59d29b09aae565feeef8e52f47c3cd5368c663","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"01faf1b029d87701e6870604dd390145","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xdf6ef343350780bf8c3410bf062e0c015b1dd671","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f61b0ac1c69f8a768690749cb054d436","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf028adee51533b1b47beaa890feb54a457f51e89","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"78780bad904978ef71351439ceba4f1d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xdD6Bf56CA2ada24c683FAC50E37783e55B57AF9F","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"29b92c53ac768b3522fcfdcc36e9aa74","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"45a96fe55f85ef5cf4115974fec74d42","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7f1e2c7d6a69bf34824d72c53b4550e895c0d8c2","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"909aeea5c9eeaffdcdd383a9df78f138","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x9E77D5a1251b6F7D456722A6eaC6D2d5980bd891","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"041673aecfeddec08cf1d97bd7d4ae6e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x5Af2Be193a6ABCa9c8817001F45744777Db30756","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"98328fe9cb834ee29bd74f449a30be75","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x73dd069c299a5d691e9836243bcaec9c8c1d8734","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b8232c68586fdfbc0641f9de67111acb","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7d4b8Cce0591C9044a22ee543533b72E976E36C3","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d6d05224edb65c7f9b3abefe546ff7f8","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1d462414fe14cf489c7A21CaC78509f4bF8CD7c0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ad7e0e4001023e84e5c90f7b9e5f8952","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x56ba2Ee7890461f463F7be02aAC3099f6d5811A8","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ccea20e262df163d2fb64c77a955a44d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x28577A6d31559bd265Ce3ADB62d0458550F7b8a7","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"56f1ff098a9bd92f47319f3acbc8b66f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x177d39AC676ED1C67A2b268AD7F1E58826E5B0af","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e4c46e2a00d43442e27f30737f5b2c23","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x12FEF5e57bF45873Cd9B62E9DBd7BFb99e32D73e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"206ff5b4f56cb2f168ef6d0284ec3250","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7e667525521cF61352e2E01b50FaaaE7Df39749a","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"83e72ffcc2f940ce9a3337aefb3db5f0","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xb2f7eb1f2c37645be61d73953035360e768d81e6","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ea27e62b9262b8f1c08ad34df84102f6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xAef38fBFBF932D1AeF3B808Bc8fBd8Cd8E1f8BC5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"56a2231a62c0903c3b33a87b006cf633","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4E0603e2A27A30480E5e3a4Fe548e29EF12F64bE","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f55d58c030052c83c3d97ffad6616418","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xE4c94d45f7Aef7018a5D66f44aF780ec6023378e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"42dfc2b2779c7b26cc855457cf9e972e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xBf4cFD7d1eDeeEA5f6600827411B41A21eB08abd","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"98927b3c98a7ef3512bb68354dc2a4d1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x41e5560054824eA6B0732E656E3Ad64E20e94E45","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"9424c5b71d651b4696aba7d7c15fc4eb","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xdab0C31BF34C897Fb0Fe90D12EC9401caf5c36Ec","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"49d1deef0450dad54a97bf6e490aeb0a","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x07d9e49ea402194bf48a8276dafb16e4ed633317","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b486527f1f8a15e28c0f088f1b423472","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xBB9bc244D798123fDe783fCc1C72d3Bb8C189413","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b22448ea9c200e4067feabbbf4cc65f5","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0cf0ee63788a0849fe5297f3407f701e122cc023","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4f4e446f53ee3847c2647919b639ebf5","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1b5f21ee98eed48d292e8e2d3ed82b40a9728a22","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4b8d84ae04b9811c308016445e051663","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xcC4eF9EEAF656aC1a2Ab886743E98e97E090ed38","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e358b8752ebf77b4994f0501067c2cd3","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x3597bfD533a99c9aa083587B074434E61Eb0A258","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f35a03f23007749992c5681256756da4","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xE0B7927c4aF23765Cb51314A0E0521A9645F0E2A","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"756b7c7e2bf01a392e75a0051a1e6dac","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x55b9a11c2e8351b4Ffc7b11561148bfaC9977855","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5623e9b2496c81dfc779c2eb22dd6a53","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x2e071D2966Aa7D8dECB1005885bA1977D6038A65","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"fa141cfa4aa27c37ce560e0db7fb2918","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0AbdAce70D3790235af448C88547603b945604ea","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"56576126bc3419515c9cda893468f9e4","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x3c75226555FC496168d48B88DF83B95F16771F37","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2734ce912998e72d771908a7be5ad674","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x01b3Ec4aAe1B8729529BEB4965F27d008788B0EB","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a706fae5d16d747dd70c98173c8498df","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x621d78f2EF2fd937BFca696CabaF9A779F59B3Ed","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"7fff5bc05d85ef302d6b0657d713b113","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xa578aCc0cB7875781b7880903F4594D13cFa8B98","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a36bf42949d7eb24ad167f08a4cf6d55","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xced4e93198734ddaff8492d525bd258d49eb388e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"aa27ed42899f1a23a223e194be53fda3","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf9F0FC7167c311Dd2F1e21E9204F87EBA9012fB2","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2599de3d3afad9e6915e8149aab2c817","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x08711D3B02C8758F2FB3ab4e80228418a7F8e39c","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"c8653d26e3006c4f1dbeaa2e009c6635","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xc8C6A31A4A806d3710A7B38b7B296D2fABCCDBA8","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5949672ed1936bbaf8ba46e5b4389e1b","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB802b24E0637c2B87D2E8b7784C055BBE921011a","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4efa1ed89fe35deedbc362bb9a82c4cf","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x86Fa049857E0209aa7D9e616F7eb3b3B78ECfdb0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"985e11592c4a22cbd313335b74f8f489","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1b9743f556d65e757c4c650b4555baf354cb8bd3","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"df058bb0c27ca765ed280b551ba3f45d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x190e569bE071F40c704e15825F285481CB74B6cC","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"96ce9c66b243f784920c0c6a62900005","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0ABeFb7611Cb3A01EA3FaD85f33C3C934F8e2cF4","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"c887c847bd8016f3097f1370d39ea7fa","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe6f74dcfa0e20883008d8c16b6d9a329189d0c30","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"06e2adb7fb1e29f1844f6bd7d68b8fa1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEA38eAa3C86c8F9B751533Ba2E562deb9acDED40","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"0266ae8255bd58bb6f889d84e7902fcf","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x419D0d8BdD9aF5e606Ae2232ed285Aff190E711b","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5fee73c4d609ddffeb04737fee700dad","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x88FCFBc22C6d3dBaa25aF478C578978339BDe77a","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"44fbdc5596041e6021101a2c4633c570","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7585F835ae2d522722d2684323a0ba83401f32f5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4cd4ceadc39955b6e535b3f470ea4617","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x24083Bb30072643C3bB90B44B7285860a755e687","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"38b2b4d868012f72af876c242804a20d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x6810e776880C02933D47DB1b9fc05908e5386b96","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"cfc7b2fb7a029c443faed1687a942a10","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xa74476443119A942dE498590Fe1f2454d7D4aC0d","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ef7fa09e285d371dec9ab6a0e1a8f366","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x025abAD9e518516fdaAFBDcdB9701b37fb7eF0FA","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b45bf5d66a4a552912d36e555800f999","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf7B098298f7C69Fc14610bf71d5e02c60792894C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5d03856cfbcc5e6cb0a3e8d622fc195d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xFeeD1a53bd53FFE453D265FC6E70dD85f8e993b6","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"fbd0d967547d5eb5cce52a0d513f9e01","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xba2184520A1cC49a6159c57e61E1844E085615B6","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"cbdb0b20ee5d51249f09c2828d61325d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x14F37B574242D366558dB61f3335289a5035c506","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a004a46019c3c3bca93250e2191cb5a9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xcbCC0F036ED4788F63FC0fEE32873d6A7487b908","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"939b8ec3346c6f86bfbf479696e06373","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x554C20B7c486beeE439277b4540A434566dC4C02","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6af37035f7075b42f316508374cfd0b9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x5a84969bb663fb64F6d015DcF9F622Aedc796750","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1908949eea18534b5dc6e183c1506948","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x888666CA69E0f178DED6D75b5726Cee99A87D698","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"830bee448d6a7b931a4a5fa1670932e9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x014B50466590340D41307Cc54DCee990c8D58aa8","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8e96e6f42a3625fc834e0470d7570cde","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x814cafd4782d2e728170fda68257983f03321c58","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"acbe5efa740c6c59f7c04ddf26bded70","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7654915a1b82d6d2d0afc37c52af556ea8983c7e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e1c193866133a852bba19ed396711a25","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x88AE96845e157558ef59e9Ff90E766E22E480390","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d8a35d8f7d1bb0bd99dbfa925fd2b6fb","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xED19698C0abdE8635413aE7AD7224DF6ee30bF22","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"835fb5103fc93fc9ae696c830de06b99","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf8e386EDa857484f5a12e4B5DAa9984E06E73705","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e0ed0817e4acc1a5b2ca3cf42442c32d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0aeF06DcCCC531e581f0440059E6FfCC206039EE","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"dd62631bb57a944f1380b4f750586c7b","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xfca47962d45adfdfd1ab2d972315db4ce7ccf094","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"26ec54cc72e1962f41d43fff46947d34","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x8727c112C712c4a03371AC87a74dD6aB104Af768","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"c85a608c5eed8bee83150c116fb4d86e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xc1E6C6C681B286Fb503B36a9dD6c1dbFF85E73CF","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3ba8d9a95f216acce33af14bc82ad460","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x773450335eD4ec3DB45aF74f34F2c85348645D39","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a32701c165dec912266e68e699a713cd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x27695E09149AdC738A978e9A678F99E4c39e9eb9","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"788b8dc689cd6e1fbf59a2a956e0907d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x818Fc6C2Ec5986bc6E2CBf00939d90556aB12ce5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"302331c79f3c453b4f3ce9a61f3027f1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xdd974D5C2e2928deA5F71b9825b8b646686BD200","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"765d21cc5d2b20b14228526769329a07","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xff18dbc487b4c2e3222d115952babfda8ba52f5f","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"884bf5344e2921e8976d3a66df00460e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x514910771af9ca656af840dff83e8264ecf986ca","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6fd48dfd3e8c4e505b1bfb3e17848a12","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x21aE23B882A340A22282162086bC98D3E2B73018","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"9451be739c41080e373461170f46c1fe","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x63e634330A20150DbB61B15648bC73855d6CCF07","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"dcecfd26c2eadb477719f0421352b3cc","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEF68e7C694F40c8202821eDF525dE3782458639f","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6e0dfe36d616732069bc8b4e10d5bddb","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xFB12e3CcA983B9f59D90912Fd17F8D745A8B2953","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"89f2696562cca9f8ac292af888a12a9f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xfa05A73FfE78ef8f1a739473e462c54bae6567D9","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ca5ad9448fa77d43fe1c617cd23b77f6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0F5D2fB29fb7d3CFeE444a200298f468908cC942","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f793846bc6cc1fc360c1d4798ee6f124","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x386467f1f3ddbe832448650418311a479eecfc57","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2631bf1527913ceaeea2dcc65374fc3f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x93E682107d1E9defB0b5ee701C71707a4B2E46Bc","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f8ccfcff58a952709e2689c7c4c6c2cc","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x138A8752093F4f9a79AaeDF48d4B9248fab93c9C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"7af8135c95d7f0fea56fa41c788e8c0e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB63B606Ac810a52cCa15e44bB630fd42D8d1d83d","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"217b7987c24ce4f22156e45deafa0112","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x51DB5Ad35C671a87207d88fC11d593AC0C8415bd","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"aa1676cea02c76ffffb8fff25bf0d952","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x40395044Ac3c0C57051906dA938B54BD6557F212","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"402fce41f095b839013d97f6d60d835e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe23cd160761f63FC3a1cF78Aa034b6cdF97d3E0C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1375a130754ff66f906ec1f32a48c3eb","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xC66eA802717bFb9833400264Dd12c2bCeAa34a6d","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8fdbae277934794c77d74ec5a86185a4","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xBEB9eF514a379B997e0798FDcC901Ee474B6D9A1","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"05c6876f1326d96d036e2680a3ba3f2b","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1a95B271B0535D15fa49932Daba31BA612b52946","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"77bf599342b286b2c88139bfca20e8b9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xAB6CF87a50F17d7F5E1FEaf81B6fE9FfBe8EBF84","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f0cd17728bf108d60682b9aae0f6cc7e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x68AA3F232dA9bdC2343465545794ef3eEa5209BD","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f33741b70a25b9cb64988c9289e6938d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xaF4DcE16Da2877f8c9e00544c93B62Ac40631F16","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2b4bd8f689625dc9e2c14ca8324d7a25","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xF433089366899D83a9f26A773D59ec7eCF30355e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"9f3fd6a17914a2e316cd44e41c03afa2","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7FC408011165760eE31bE2BF20dAf450356692Af","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2a7a01493914bfe214d6d9867295c14e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0AF44e2784637218dD1D32A322D44e603A8f0c6A","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"ce90fd27b0697700dc5366e652db065c","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf7e983781609012307f2514f63D526D83D24F466","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"10954fdf3ef1c94befd768435c4be058","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xa645264C5603E96c3b0B078cdab68733794B0A71","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"0a8cc09aaddec603b4548ab9c4055163","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xcfb98637bcae43C13323EAa1731cED2B716962fD","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"814b71c7cad497b8b98e917ec2827023","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x1776e1F26f98b1A5dF9cD347953a26dd3Cb46671","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"15e005ae9cb24a31821f3df6533f5fe1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x45e42D659D9f9466cD5DF622506033145a9b89Bc","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d79ef6160578588f725b21f2421d0d16","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x5c6183d10A00CD747a6Dbb5F658aD514383e9419","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e03c7fff02a4b9a2bfc9431f09ebf980","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe26517A9967299453d3F1B48Aa005E6127e67210","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"40a27dc58aa6497af4f0acbf1b53b3b9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x701C244b988a513c945973dEFA05de933b23Fe1D","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"0dc408f23a39c78340e7eb9cff0b4743","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7F2176cEB16dcb648dc924eff617c3dC2BEfd30d","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"628f7e0cb7a1a0ec144403d8a496bb30","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xd26114cd6EE289AccF82350c8d8487fedB8A0C07","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"dfb533148d185882e2204ea1bc380fd2","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4355fC160f74328f9b383dF2EC589bB3dFd82Ba0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8e83438df2e9521a3e1d28a18c29aa28","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB97048628DB6B661D4C2aA833e95Dbe1A905B280","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"eeaae88c8e18bab71e61eb21cc72449c","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x8eFFd494eB698cc399AF6231fCcd39E08fd20B15","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2e3e8d10d71caa73fb0835019859de96","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0AfFa06e7Fbe5bC9a764C979aA66E8256A631f02","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4c97a54ceaa3ed64e238e0c4e986373d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe3818504c1B32bF1557b16C238B2E01Fd3149C17","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d972ca79371b32b965c49bd215c1b7a0","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xD8912C10681D8B21Fd3742244f44658dBA12264E","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e6f152050c8f4f737e8c6c0259b90d73","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0e0989b1f9b8a38983c2ba8053269ca62ec9b195","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"77f283e70e7b3a8727b5560801f81a1e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xee609fe292128cad03b786dbb9bc2634ccdbe7fc","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6b6516f0b7958fbe466a3059f3f3a522","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xd4fa1460F537bb9085d22C7bcCB5DD450Ef28e3a","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3b08b564f7b534f887f384e251413053","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x226bb599a12C826476e3A771454697EA52E9E220","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3a51c22308a12890f36db86d6e28ce07","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x163733bcc28dbf26B41a8CfA83e369b5B3af741b","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"cd3bba98b068ddba33b3df03440d010f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0c04d4f331da8df75f9e2e271e3f3f1494c66c36","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d92abfa101bf557f01860b7ff3b13e06","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x66497a283e0a007ba3974e837784c6ae323447de","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b0e9094da1cc5d62ad16ca23e0dea273","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x8Ae4BF2C33a8e667de34B54938B0ccD03Eb8CC06","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8573fa6705be6e05ae936b2b752f4b13","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x671AbBe5CE652491985342e85428EB1b07bC6c64","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d80d82fb8fd555260c2ad2e1188f89d9","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x9a642d6b3368ddc662CA244bAdf32cDA716005BC","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e427bbfe20a1123199b40824baedc583","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x697beac28B09E122C4332D163985e8a73121b97F","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1c27d69cf8e552c7932fab671a66821f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xE94327D07Fc17907b4DB788E5aDf2ed424adDff6","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6531e17165e3424801725798decd2868","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf05a9382A4C3F29E2784502754293D88b835109C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1e8acaafeb472d4a8595d103a4353128","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x607F4C5BB672230e8672085532f7e901544a7375","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3c1283113b97bc346007e580c321a0fc","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xcCeD5B8288086BE8c38E23567e684C3740be4D48","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"43e06ff71a2c5dc3068fcd8fa87531be","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4a42d2c580f83dce404acad18dab26db11a1750e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"712fc8795dcebae194dbd302e4751bec","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4993CB95c7443bdC06155c5f5688Be9D8f6999a5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8d33f760ef08ac88629405cbd2a29eb1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x3d1ba9be9f66b8ee101911bc36d3fb562eac2244","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"34fbfaa3be230111bdda05e81dd57963","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x7C5A0CE9267ED19B22F8cae653F198e3E8daf098","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"1fe61f4b49c909361dc8e776cc796a3a","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xd7631787B4dCc87b1254cfd1e5cE48e96823dEe8","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"58d58f56648093aab792634c61346491","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4ca74185532dc1789527194e5b9c866dd33f4e82","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"25c46831515715c4e0ebcf72212b3930","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xa1ccc166faf0E998b3E33225A1A0301B1C86119D","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a852e400fafc5efc74136be178fcb79e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xd248B0D48E44aaF9c49aea0312be7E13a6dc1468","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e18cf73898a9f36717894e85254976dd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEF2E9966eb61BB494E5375d5Df8d67B7dB8A780D","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b0b948cdefd85958b00d0bc512bb9177","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x8a187d5285d316bcbc9adafc08b51d70a0d8e000","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d27a172bb9086e07bd3e0d3ac4003bf8","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x2bDC0D42996017fCe214b21607a515DA41A9E0C5","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"730137306fb200be2dd29e72b5de69ab","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4994e81897a920c0FEA235eb8CEdEEd3c6fFF697","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"c4964487d965869050f824efebf1fc90","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xF4134146AF2d511Dd5EA8cDB1C4AC88C57D60404","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6ac9295e1e0040fc225e456631b12507","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xaeC2E87E0A235266D9C5ADc9DEb4b2E29b54D009","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"0dfff912cf0d3136fa2b06458d786c83","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xf333b2Ace992ac2bBD8798bF57Bc65a06184afBa","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2873ccd0a39206f00febb10c2443d322","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x983F6d60db79ea8cA4eB9968C6aFf8cfA04B3c63","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"b83461a429c78360d7fbc1de18cd8b0f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x744d70FDBE2Ba4CF95131626614a1763DF805B9E","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"cbb8f63a4829519c23dccadcb2f1cf65","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x58bf7df57d9DA7113c4cCb49d8463D4908C735cb","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5edb60d342f13e97014be18f0f6ce779","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x24aef3bf1a47561500f9430d74ed4097c47f51f2","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"5409df5b63cdfdea569e6d8cf2957048","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB64ef51C888972c908CFacf59B47C1AfBC0Ab8aC","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"74bad955449a3b2137d0ba147427cfad","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x46492473755e8dF960F8034877F61732D718CE96","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d9151b094fac338d27b5a8931550f771","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x006BeA43Baa3f7A6f765F14f10A1a1b08334EF45","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f88b7b30f5093e36311d73aedb77fbfe","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x12480E24eb5bec1a9D4369CaB6a80caD3c0A377A","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"6c56b7308b0954908a96522f17b3dfba","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB9e7F8568e08d5659f5D29C4997173d84CdF2607","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"11d1546abb2eb390d5eff898e6a1e10d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x10b123fddde003243199aad03522065dc05827a0","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8258095f5319f6d9483a2851311277c6","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xE7775A6e9Bcf904eb39DA2b68c5efb4F9360e08C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"56eaea864be46979c09032b9876d7767","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xAFe60511341a37488de25Bef351952562E31fCc1","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2477557fff2da6fe4df411ce7d9c2890","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xa7f976C360ebBeD4465c2855684D1AAE5271eFa9","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8e14d49d4ef52e49deac9c4e92b92c3d","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xFACCD5Fc83c3E4C3c1AC1EF35D15adf06bCF209C","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"370f3b2cfaccee2b88dfd5e9c31021ec","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x6531f133e6DeeBe7F2dcE5A0441aA7ef330B4e53","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"275e2a112329c32dc207688893ec13d2","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEa1f346faF023F974Eb5adaf088BbCdf02d761F4","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"78976bf0c2b73b1b62593e23347da8db","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xaAAf91D9b90dF800Df4F55c205fd6989c977E73a","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"7d593bf275b6c4977714a655d23c6137","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xEe22430595aE400a30FFBA37883363Fbf293e24e","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3c8cd43a79c3dace670eee18bde94b9b","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x08f5a9235b08173b7569f83645d2c7fb55e8ccd8","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"8bab33d9aa111956377f5d8d14dcf286","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xCb94be6f13A1182E4A4B6140cb7bf2025d28e41B","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"55056056994143116a7a7cf9ffb8379f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"9331e66f236c690fe4df5c2de38db2cd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x8f3470A7388c05eE4e7AF3d01D8C722b0FF52374","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"d09e1975977c63cb2120e3cf36357e1f","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xD850942eF8811f2A866692A623011bDE52a462C1","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"a0e1ec1b695ec1d8fbd0c3caa3741b22","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe8ff5c9c75deb346acac493c463c8950be03dfba","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"2a966c80a728c7bc8fa9cb6a68592201","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x882448f83d90b2bf477af2ea79327fdea1335d93","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"4bddf5c6e4c1d6647bca1fa32c2fe6dd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x2C974B2d0BA1716E644c1FC59982a89DDD2fF724","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"068a223fe642ac5c2a28894df6b78818","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x83eEA00D838f92dEC4D1475697B9f4D3537b56E3","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3f1c86744c1dbd6ab1e1e91c3a2d8f6e","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xeDBaF3c5100302dCddA53269322f3730b1F0416d","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"bf9b519577003cd6616a243307c8d6a1","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x5c543e7AE0A1104f78406C340E9C64FD9fCE5170","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"f50795a07d7154e0e44838427b046ec3","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x82665764ea0b58157E1e5E9bab32F68c76Ec0CdF","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"da1b24843003af29f59e454b75bc2289","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x03c18d649e743ee0b09f28a81d33575f03af9826","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"e5248376d7625ec606bbbb090d6de8b4","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x6a0A97E47d15aAd1D132a1Ac79a480E3F2079063","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"731309d45f95b2f1b9637c694507fd11","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x5e4ABE6419650CA839Ce5BB7Db422b881a6064bB","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"36449863fb7b2b4597b08b4c9425facd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x667088b212ce3d06a1b553a7221E1fD19000d9aF","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"38d705fef5d5d3a71e5fff7dcab143db","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x728781E75735dc0962Df3a51d7Ef47E798A7107E","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"bc1d19fc95e8227d6a1ad116802f4a13","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x4DF812F6064def1e5e029f1ca858777CC98D2D81","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"16cbd68d80262a2a5c41263f9f5298cd","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB110eC7B1dcb8FAB8dEDbf28f53Bc63eA5BEdd84","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"3247218128c20aca32f576db01411d14","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xB24754bE79281553dc1adC160ddF5Cd9b74361a4","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"16bea2d8af01c4c63d45c6edd4f75837","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x0F33bb20a282A7649C7B3AFf644F084a9348e933","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"c56937c399eb9dbdcb2bb141ba7ad363","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xE41d2489571d322189246DaFA5ebDe1F4699F498","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]},{"id":"de460247f3b735efc347655570ef7edc","jsonrpc":"2.0","method":"eth_call","params":[{"to":"0xe386b139ed3715ca4b18fd52671bdcea1cdfe4b1","data":"0x70a082310000000000000000000000008bbf8f56ed5c694bef9f0f6d74365d663517e67a"},"pending"]}]

* 
*/
