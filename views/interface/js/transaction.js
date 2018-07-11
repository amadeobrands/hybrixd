var U = utils;
var Storage = storage;
var LZString_ = LZString;

sendTransaction = function (properties, GLOBAL_ASSETS, modeHashes, onSucces, onError) {
  var H = hybridd; // TODO: Factor up. Can't now, smt's up with dependency order.
  var UItransform_ = UItransform;

  var asset = R.prop('asset', properties);
  var assetID = R.prop('symbol', asset);
  var factor = R.prop('factor', asset);

  var transactionData = mkTransactionData(properties, factor);
  var totalAmountStr = mkTotalAmountStr(transactionData, factor);
  var emptyOrPublicKeyString = mkEmptyOrPublicKeyString(asset);
  var unspentUrl = mkUnspentUrl(assetID, totalAmountStr, emptyOrPublicKeyString, transactionData);
  var modeStr = mkModeHashStr(modeHashes, properties);

  var modeFromStorageStream = Storage.Get_(modeStr);
  var transactionDataStream = rxjs.of(transactionData);
  var feeBaseStream = rxjs.of(asset)
    .pipe(
      rxjs.operators.map(checkBaseFeeBalance(GLOBAL_ASSETS))
    );

  var unspentStream = H.mkHybriddCallStream(unspentUrl)
    .pipe(
      rxjs.operators.map(checkProcessProgress),
      rxjs.operators.retryWhen(function (errors) {
        return errors.pipe(
          rxjs.operators.delayWhen(function (_) {
            return rxjs.timer(1000);
          })
        );
      })
    );

  var doTransactionStream = rxjs
    .combineLatest(
      unspentStream,
      modeFromStorageStream,
      transactionDataStream,
      feeBaseStream
    )
    .pipe(
      rxjs.operators.map(getDeterministicData),
      rxjs.operators.map(getDeterministicTransactionData),
      rxjs.operators.flatMap(doPushTransactionStream),
      rxjs.operators.map(handleTransactionPushResult)
    );

  var finalizeTransactionStream = rxjs
    .combineLatest(
      transactionDataStream,
      doTransactionStream
    );

  UItransform_.txStart();
  finalizeTransactionStream.subscribe(onSucces, onError);
};

function getDeterministicData (z) {
  var decodedData = R.nth(1, z);
  var deterministicData = R.compose(
    U.activate,
    LZString_.decompressFromEncodedURIComponent
  )(decodedData);

  if (typeof deterministicData !== 'object' || deterministicData === {}) {
    throw 'Sorry, the transaction could not be generated! Deterministic code could not be initialized!';
  } else {
    return R.append(deterministicData, z);
  }
}

function getDeterministicTransactionData (z) {
  var transactionData = R.nth(2, z);
  var deterministic = R.nth(4, z);
  var asset = R.prop('asset', transactionData);
  var factor = R.path(['asset', 'factor'], transactionData);
  var assetID = R.path(['asset', 'id'], transactionData);
  // var fee = R.nth(3, z)

  var changeLens = R.lensProp('change');
  var unspent = R.compose(
    R.unless(
      R.compose(
        R.isNil,
        R.view(changeLens)
      ),
      R.over(
        changeLens,
        R.flip(toInt)(factor)
      )
    ),
    R.prop('data'),
    R.nth(0)
  )(z);

  var feeSymbolEqualsId = R.equals(
    R.prop('id', asset),
    R.prop('fee-symbol', asset)
  );
  var feeFactor = feeSymbolEqualsId
    ? R.prop('factor', asset)
    : R.compose(
      R.prop('factor'),
      R.find(
        R.propEq('id', R.prop('fee-symbol', asset)
        ))
    )(GL.assets);

  var data = {
    mode: R.path(['asset', 'mode'], transactionData).split('.')[1],
    symbol: R.path(['asset', 'symbol'], transactionData),
    source: R.prop('sourceAddress', transactionData),
    target: R.prop('targetAddress', transactionData),
    amount: toInt(R.prop('amount', transactionData), factor),
    fee: toInt(R.prop('fee', transactionData), feeFactor),
    factor: factor,
    contract: R.path(['asset', 'contract'], transactionData),
    keys: R.path(['asset', 'keys'], transactionData),
    seed: R.path(['asset', 'seed'], transactionData),
    unspent
  };

  var checkTransaction = deterministic.transaction(data, handlePushInDeterministic(assetID, transactionData));

  if (R.isNil(checkTransaction)) {
    throw 'Handling in deterministic.';
  } else {
    return [checkTransaction, R.path(['asset', 'symbol'], transactionData)];
  }
}

function doPushTransactionStream (z) {
  var transaction = R.nth(0, z);
  var assetID = R.nth(1, z);
  var url = 'a/' + assetID + '/push/' + transaction;
  return H.mkHybriddCallStream(url)
    .pipe(
      rxjs.operators.map(function (processData) {
        var isProcessInProgress = R.isNil(R.prop('data', processData)) &&
                                  R.equals(R.prop('error', processData), 0);
        if (isProcessInProgress) throw processData;
        return processData;
      }),
      rxjs.operators.retryWhen(function (errors) {
        return errors.pipe(
          rxjs.operators.delayWhen(function (_) {
            return rxjs.timer(1000);
          })
        );
      })
    );
}

function handleTransactionPushResult (res) {
  var transactionHasError = R.equals(R.prop('error', res), 1);
  var transactionIsValid = R.not(R.equals(typeof R.prop('data', res), 'undefined')) &&
                           R.equals(R.prop('error', res), 0);
  if (transactionIsValid) {
    // TODO: RENDER DATA IN DOM;
    return 'Node sent transaction ID: ' + R.prop('data', res);
  } else if (transactionHasError) {
    throw R.prop('data', res);
  } else {
    throw 'The transaction could not be sent by the hybridd node! Please try again.';
  }
}

function handlePushInDeterministic (assetID, transactionData) {
  return function (txData) {
    var H = hybridd; // TODO: Factor up. Can't now, smt's up with dependency order.
    var url = 'a/' + assetID + '/push/' + txData;
    var pushStream = H.mkHybriddCallStream(url)
      .pipe(
        rxjs.operators.map(function (processData) {
          var isProcessInProgress = R.isNil(R.prop('data', processData)) &&
                                    R.equals(R.prop('error', processData), 0);
          if (isProcessInProgress) throw processData;
          return processData;
        }),
        rxjs.operators.retryWhen(function (errors) {
          return errors.pipe(
            rxjs.operators.delayWhen(function (_) {
              return rxjs.timer(1000);
            })
          );
        })
      );

    pushStream.subscribe(function (processResponse) {
      var processData = R.prop('data', processResponse);
      var dataIsValid = R.not(R.isNil(processData)) &&
                              R.equals(R.prop('error', processResponse), 0);
      var newBalance = R.prop('balanceAfterTransaction', transactionData).toFixed(21);
      if (dataIsValid) {
        UItransform.deductBalance(R.prop('element', transactionData), assetID, newBalance);
        setTimeout(function () {
          UItransform.txStop();
          UItransform.txHideModal();
        }, 1000);
        // push function returns TXID
        logger('Node sent transaction ID: ' + processData);
      } else {
        UItransform.txStop();
        logger('Error sending transaction: ' + processData);
        alert('<br>Sorry! The transaction did not work.<br><br><br>This is the error returned:<br><br>' + processData + '<br>');
      }
    });
  };
}

function checkBaseFeeBalance (assets) {
  return function (a) {
    var assetID = R.prop('id', a);
    var feeBase = R.prop('fee-symbol', a);
    var fee = R.prop('fee', a);
    // TODO: mk into general function?
    var baseBalance = R.compose(
      R.defaultTo(0),
      R.path(['balance', 'amount']),
      R.find(R.propEq('id', feeBase))
    )(assets);

    if (baseBalance > fee) {
      return true;
    } else {
      throw '<br><br>You do not have enough ' + R.toUpper(feeBase) + ' in your wallet to be able to send ' + R.toUpper(assetID) + ' tokens! Please make sure you have activated ' + R.toUpper(feeBase) + ' in the wallet.<br><br>';
    }
  };
}

function mkTransactionData (p, factor) {
  var asset = R.prop('asset', p);
  var amount = Number(R.prop('amount', p));
  var fee = Number(R.prop('fee', asset));

  var originalBalance = toInt(R.path(['balance', 'amount'], asset));

  function mkNewBalance (a) {
    if (isToken(R.prop('symbol', a))) {
      return fromInt(toInt(originalBalance, factor)
        .minus(toInt(amount, factor)),
      factor);
    } else {
      return fromInt(toInt(originalBalance, factor)
        .minus(toInt(amount, factor)
          .plus(toInt(fee, factor))),
      factor);
    }
  }

  var balanceAfterTransaction = mkNewBalance(asset);

  return {
    amount,
    asset,
    balanceAfterTransaction,
    element: '.assets-main > .data .balance-' + R.prop('symbol', asset).replace(/\./g, '-'),
    fee,
    sourceAddress: String(R.prop('source', p)).trim(),
    targetAddress: String(R.prop('target', p)).trim()
  };
}

function mkEmptyOrPublicKeyString (asset) {
  return R.compose(
    R.when(
      function (key) { return R.not(R.equals('', key)); },
      R.concat('/')
    ),
    R.defaultTo(''),
    R.path(['keys', 'publicKey'])
  )(asset);
}

function mkTotalAmountStr (t, factor) {
  var asset = R.prop('asset', t);
  var feeSymbolEqualsId = R.equals(
    R.prop('id', asset),
    R.prop('fee-symbol', asset)
  );
  var feeFactor = feeSymbolEqualsId
    ? R.prop('factor', asset)
    : R.compose(
      R.prop('factor'),
      R.find(
        R.propEq('id', R.prop('fee-symbol', asset)
        ))
    )(GL.assets);

  var amountBigNumber = toInt(R.prop('amount', t), feeFactor);
  var feeBigNumber = toInt(R.prop('fee', t), feeFactor);
  var amountWithFeeBigNumber = amountBigNumber.plus(feeBigNumber, feeFactor);

  return fromInt(amountWithFeeBigNumber, feeFactor).toString();
}

// prepare universal unspent query containing: source address / target address / amount / public key
function mkUnspentUrl (id, amount, publicKey, t) {
  return 'a/' +
    id +
    '/unspent/' +
    R.prop('sourceAddress', t) + '/' +
    amount + '/' +
    R.prop('targetAddress', t) +
    publicKey;
}

function checkProcessProgress (processData) {
  var isProcessInProgress = R.isNil(R.prop('data', processData)) &&
                            R.equals(R.prop('error', processData), 0);
  if (isProcessInProgress) throw processData;
  return processData;
}

function mkModeHashStr (modeHashes, p) {
  return R.compose(
    R.flip(R.concat)('-LOCAL'),
    R.prop(R.__, modeHashes),
    R.nth(0),
    U.splitAtDot,
    R.path(['asset', 'mode'])
  )(p);
}
