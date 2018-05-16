var fetch_ = fetch
var U = utils;

const userIdInputStr = Rx.Observable
      .fromEvent(document.querySelector('#inputUserID'), 'input')
      .map(U.getTargetValue);

const passwordInputStream = Rx.Observable
      .fromEvent(document.querySelector('#inputPasscode'), 'input')
      .map(U.getTargetValue);

loginInputStreams = {
  credentialsStream: Rx.Observable
    .combineLatest(userIdInputStr, passwordInputStream),

  mkInputStream: function (query) {
    return Rx.Observable
      .fromEvent(document.querySelector(query), 'keydown')
      .filter(function (e) { return e.key === 'Enter'; });
  },

  mkSessionStepFetchPromise: function (sessionData, stepNameStr) {
  return fetch_(sessionData.url)
    .then(r => r.json()
          .then(stepData => {
            var defaultOrAssociatedStepData = stepNameStr === 'postSessionStep1Data'
                ? R.assoc('sessionStep1', stepData, {})
                : stepData

            return R.merge(sessionData, defaultOrAssociatedStepData);
          })
          .catch(e => console.log(stepNameStr + ': Error retrieving data:', e)))
    .catch(e => console.log('Error fetching data:', e));
}
};
