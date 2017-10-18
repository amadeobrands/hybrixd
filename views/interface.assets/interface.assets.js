init.interface.assets = function(args) {
  topmenuset('assets');  // top menu UI change
  clearInterval(intervals); // clear all active intervals

  clipb_success = function() { console.log('Data copied to clipboard.'); $('#action-receive .modal-receive-addressfrom').pulse({times: 5, duration: 250}) };
  clipb_fail = function(err) {
    alert("This browser cannot automatically copy to the clipboard! \n\nPlease select the text manually, and press CTRL+C to \ncopy it to your clipboard.\n");
  };
  
  // modal helper functions
  fill_send = function(asset,balance) {
    var spendable = formatFloat(toInt(balance).minus(toInt(assets.fees[asset])));
    if(spendable<0) { spendable=0; }
    $('#action-send .modal-send-currency').html(asset.toUpperCase());
    $('#action-send .modal-send-currency').attr('asset',asset);
    $('#action-send .modal-send-balance').html(formatFloat(spendable));
    $('#modal-send-target').val('');
    $('#modal-send-amount').val('');
    $('#action-send .modal-send-addressfrom').html(assets.addr[asset]);
    $('#action-send .modal-send-networkfee').html(String(assets.fees[asset]).replace(/0+$/, '')+' '+asset.toUpperCase());
    check_tx();
  }
  fill_recv = function(asset,balance) {
    $('#action-receive .modal-receive-currency').html(asset.toUpperCase());
    // after getting address from hybridd, set data-clipboard-text to contain it
    $('#action-receive .modal-receive-addressfrom').html(assets.addr[asset]);
    $('#modal-receive-button').attr('data-clipboard-text', $('#action-receive .modal-receive-addressfrom').html() ) // set clipboard content for copy button to address
    clipboardButton('#modal-receive-button', clipb_success, clipb_fail); // set function of the copy button
    $('#action-receive .modal-receive-status').attr('id','receivestatus-'+asset);
    $("#qrcode").html('').append( function() {
      new QRCode(document.getElementById("qrcode"),
          { text:assets.addr[asset],
            width: 160,
            height: 160,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
          });
    });
  }
  stop_recv = function() {
    $('#action-receive .modal-receive-status').attr('id','receivestatus'); // reset status ID attribute to avoid needless polling
  }
  check_tx = function() {
      var p = {};
      p.asset = $('#action-send .modal-send-currency').attr('asset');
      p.target_address = String($('#modal-send-target').val());
      p.amount = Number($("#modal-send-amount").val());
      p.available = Number($('#action-send .modal-send-balance').html());
      if(!isNaN(p.amount) && p.amount>0 && p.amount<=p.available && p.target_address) {
        $('#action-send .pure-button-send').removeClass('disabled');
      } else {
        $('#action-send .pure-button-send').addClass('disabled');
      }
  }

  send_tx = function(properties) {
    $('#action-send .pure-button-send').addClass('pure-button-disabled').removeClass('pure-button-primary');
    if(send_active==false) {
      send_active=true;
      $('#action-send').css('opacity', '0.7');
      var p = {};
      p.asset = $('#action-send .modal-send-currency').attr('asset');
      for(var j=0;j<balance.asset.length;j++) { // block balance updating for transacting asset
        if(balance.asset[j]==p.asset) { balance.lasttx[j] = (new Date).getTime(); }
      }
      p.amount = Number($("#modal-send-amount").val());
      p.fee = Number(assets.fees[p.asset]);
      p.source_address = String($('#action-send .modal-send-addressfrom').html()).trim();
      p.target_address = String($('#modal-send-target').val()).trim();
      p.element = '.assets-main > .data .balance-'+p.asset;
      p.balorig = $(p.element).html();
      p.balance = toInt(p.balorig).minus(toInt(p.amount).plus(toInt(p.fee)));
      // instantly deduct hypothetical amount from balance in GUI
      $(p.element).html('<span style="color:#D77;">'+String(p.balance))+'</span>';
      // send call to perform transaction
      if(typeof assets.fact[p.asset]!='undefined') {
        hybriddcall({r:'a/'+p.asset+'/unspent/'+p.source_address+'/'+String(toInt(p.amount).plus(toInt(p.fee))),z:1,pass:p},0, function(object,passdata) {
          // DEBUG: logger(JSON.stringify(object));
          if(typeof object.data!='undefined' && !object.err) {
            var unspent = object.data;
            var p = passdata;
            if(typeof unspent!='undefined' && typeof unspent.change!='undefined') { unspent.change = toInt(unspent.change,assets.fact[p.asset]); }
            storage.Get(assets.modehashes[ assets.mode[p.asset] ], function(dcode) {
              deterministic = activate( LZString.decompressFromEncodedURIComponent(dcode) );
              setTimeout(function() {
                if(typeof deterministic!='object' || deterministic=={}) {
                  alert('Error: Deterministic code was not properly initialized! Please ask the Internet of Coins developers to fix this.');
                  $(p.element).html(p.balorig); // restore original amount
                } else {
                  try {
                    var transaction = deterministic.transaction({
                      source:p.source_address,
                      target:p.target_address,
                      amount:toInt(p.amount,assets.fact[p.asset]),
                      fee:toInt(p.fee,assets.fact[p.asset]),
                      factor:assets.fact[p.asset],
                      keys:assets.keys[p.asset],
                      seed:assets.seed[p.asset],
                      unspent:unspent
                    });
                    if(typeof transaction!='undefined') {
                      // DEBUG: logger(transaction);
                      hybriddcall({r:'a/'+p.asset+'/push/'+transaction,z:1,pass:p},null, function(object,passdata) {
                        var p = passdata;
                        if(typeof object.data!='undefined' && object.error==0) {
                          // now deduct real amount from balance in GUI
                          $(p.element).html(String(p.balance));
                          // push function returns TXID
                          console.log('Node sent transaction ID: '+object.data);
                          // DEBUG: console.log('p.element: '+p.element); console.log('p.balance: '+p.balance);
                        } else {
                          alert('Sorry, but the node told us the transaction failed!<br /><br />'+object.data);
                          $(p.element).html(p.balorig); // restore original amount
                        }
                      });
                    } else {
                      alert('The transaction deterministic calculation failed!  Please ask the Internet of Coins developers to fix this.');
                      $(p.element).html(p.balorig); // restore original amount
                    }  
                  } catch(e) {
                    alert('Sorry, the transaction could not be generated! Please ask the Internet of Coins developers to fix this.<br /><br />'+e);
                    $(p.element).html(p.balorig); // restore original amount
                  }
                }
              },500);
            });
          } else {
            alert('Sorry, the node did not send us data about unspents for making the transaction! Maybe there was a network problem. Please simply try again.');
          }
        });
      } else {
        alert('Transaction failed. Assets were not yet completely initialized. Please try again in a moment.');
      }
      setTimeout(function() {
        send_active=false;
        // restore button, hide modal
        $('#action-send').modal('hide').css('opacity', '1');
        $('#action-send .pure-button-send').removeClass('pure-button-disabled').addClass('pure-button-primary');
      },3000);
    }
  }
  ui_assets = function(properties) {
    var i = properties.i;
    var balance = properties.balance;
    // fill asset elements
    for (j = 0; j < i; j++) {
      setTimeout(
        function(j) {      
          if(typeof balance.asset[j] !== 'undefined') {
            var element = '.assets-main > .data .balance-'+balance.asset[j].replace(/\./g,'-');
            if((balance.lasttx[j]+60000)<(new Date).getTime()) {
              hybriddcall({r:'a/'+balance.asset[j]+'/balance/'+assets.addr[balance.asset[j]],z:0},element,
                function(object){
                  if(typeof object.data=='string') { object.data = formatFloat(object.data); }
                  var assetbuttons = '.assets-main > .data .assetbuttons-'+balance.asset[j].replace(/\./g,'-');
                  if(object.data!=null && !isNaN(object.data)){
                    $(assetbuttons).delay(1000).removeClass('disabled');
                  } else {
                    $(assetbuttons).addClass('disabled');
                  }
                  return object;
                }
              );
            }
          }
        }
      ,j*500,j);
    }
  }

  // main asset management code
  $(document).ready( function(){
    // fill advanced modal with work-in-progress icon
    var output = '<div style="text-align: center; margin-left: auto; margin-right: auto; width: 30%; color: #CCC;">'+svg['cogs']+'</div>';
    $('#advancedmodal').html(output);	// insert new data into DOM

    // attached buttons and actions
    $('#send-transfer').click(function() { send_tx(); });

    // are we sending a transaction?
    send_active=false;

    // elements: MAIN
    $('.assets-main .spinner-loader').fadeOut('slow', function() {
      balance = {}
      balance.asset = [];
      balance.amount = [];
      balance.lasttx = [];
      GL.cur_step = next_step();
      $.ajax({ url: path+zchan(GL.usercrypto,GL.cur_step,'a'),
        success: function(object){
          object = zchan_obj(GL.usercrypto,GL.cur_step,object);
          var i = 0;
          var output = '';
          // create asset table
          output+='<table class="pure-table pure-table-striped"><thead>';
          output+='<tr><th>Asset</th><th>Balance</th><th class="actions"></th></tr></thead><tbody>';
          for (var entry in object.data) {
            balance.asset[i] = entry;
            balance.amount[i] = 0;
            balance.lasttx[i] = 0;
            var element=balance.asset[i].replace(/\./g,'-');
            output+='<tr><td class="asset asset-'+element+'">'+entry+'</td><td><div class="balance balance-'+element+'">'+progressbar()+'</div></td><td class="actions"><div class="assetbuttons-'+element+' disabled">';
            output+='<a onclick=\'fill_send("'+balance.asset[i]+'",$(".assets-main > .data .balance-'+entry+'").html());\' href="#action-send" class="pure-button pure-button-primary" role="button" data-toggle="modal">Send</a>';
            output+='<a onclick=\'fill_recv("'+balance.asset[i]+'",$(".assets-main > .data .balance-'+entry+'").html());\' href="#action-receive" class="pure-button pure-button-secondary" role="button" data-toggle="modal">Receive</a>';
            output+='<a href="#action-advanced" class="pure-button pure-button-grey" role="button" data-toggle="modal">Advanced</a>';
            output+='</div></td></tr>';
            i++;
          }
          output+='</tbody></table>';
          // refresh assets
          ui_assets({i:i,balance:balance,path:path});
          intervals = setInterval( function(path) {
            ui_assets({i:i,balance:balance,path:path});
          },30000,path);
          $('.assets-main > .data').html(output);	// insert new data into DOM
        }
      });
    });
  });
}
