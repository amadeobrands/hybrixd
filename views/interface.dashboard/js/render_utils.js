var Icons = black

var dashboardUI = {
  noStarredAssetsHTML: '<p>No starred assets found. <br>You can star your favorite assets in the Asset tab to make them appear here. <br><br><a class="pure-button pure-button-primary" onclick="fetchview(\'interface.assets\', pass_args);"><span>Go to My Assets</span></a></p>',
  mkHtmlForStarredAssets: function (htmlStr, asset) {
    var assetID = R.prop('id', asset);
    var hyphenizedID = assetID.replace(/\./g, '-');
    var assetElementID = 'asset-' + hyphenizedID;
    var symbolName = assetID.slice(assetID.indexOf('.') + 1);
    var icon = R.ifElse(
      R.flip(R.has)(Icons.svgs),
      R.flip(R.prop)(Icons.svgs),
      mkSvgIcon
    )(symbolName);

    return R.prop('starred', asset)
      ? htmlStr + '<div onclick="fetchview(\'interface.assets\',{user_keys: pass_args.user_keys, nonce: pass_args.nonce, asset:\'' + assetID + '\', element: \'' + assetElementID + '\'});" class="balance">' +
      '<div class="icon">' +
      icon +
      '</div>' +
      '<h5>' +
      assetID +
      '</h5>' +
      '<h3 class="balance balance-' + hyphenizedID + '">' +
      progressbar() +
      '</h3>' +
      '</div>'
      : htmlStr;
  }
};
