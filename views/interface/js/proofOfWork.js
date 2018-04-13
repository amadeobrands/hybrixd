const proofOfWork = {
  loopThroughProofOfWork: function () {
    var req = GL.powqueue.shift();
    if (typeof req !== 'undefined') {
      // attempt to send proof-of-work to node
      proofOfWork.solve(req.split('/')[1], submitProofOfWork(req), failedProofOfWork(req));
    }
  }
};

function submitProofOfWork (req) {
  return function (proof) {
    const proofOfWorkStr = req.split('/')[0] + '/' + proof;
    logger('Submitting storage proof: ' + proofOfWorkStr);
    hybriddcall({r: 's/storage/pow/' + proofOfWorkStr, z: 0}, 0, function (object) {});
  };
}

function failedProofOfWork (req) {
  // DEBUG:
  logger('failed storage proof: ' + req.split('/')[0]);
}
