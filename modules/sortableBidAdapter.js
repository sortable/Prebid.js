import * as utils from 'src/utils';
import { registerBidder } from 'src/adapters/bidderFactory';
import { config } from 'src/config';
import { BANNER, NATIVE } from 'src/mediaTypes';
import { REPO_AND_VERSION } from 'src/constants';

const BIDDER_CODE = 'sortable';
const SERVER_URL = 'c.deployads.com';

function setAssetRequired(native, asset) {
  if (native.required) {
    asset.required = 1;
  }
  return asset;
}

function buildNativeRequest(nativeMediaType) {
  const assets = [];
  const title = nativeMediaType.title;
  if (title) {
    assets.push(setAssetRequired(title, {
      title: {len: title.len}
    }));
  }
  const img = nativeMediaType.image;
  if (img) {
    assets.push(setAssetRequired(img, {
      img: {
        type: 3, // Main
        wmin: 1,
        hmin: 1
      }
    }));
  }
  utils._each(assets, (asset, id) => asset.id = id);
  return {
    ver: '1',
    request: JSON.stringify({
      ver: '1',
      assets
    })
  };
}

function tryParseNativeResponse(adm) {
  let native = null;
  try {
    native = JSON.parse(adm);
  } catch (e) {
    if (!(e instanceof SyntaxError)) {
      throw e;
    }
  }
  return native && native.native;
}

function interpretNativeResponse(response) {
  const native = {};
  if (response.link) {
    native.clickUrl = response.link.url;
  }
  utils._each(response.assets, asset => {
    if (asset.title) {
      native.title = asset.title.text;
    }
    if (asset.img) {
      if (asset.img.w || asset.img.h) {
        native.image = {
          url: asset.img.url,
          width: asset.img.w,
          height: asset.img.h
        };
      } else {
        native.image = asset.img.url;
      }
    }
  });
  return native;
}

function transformSyncs(responses, type, syncs) {
  utils._each(responses, res => {
    if (res.body && res.body.ext && res.body.ext.sync_dsps && res.body.ext.sync_dsps.length) {
      utils._each(res.body.ext.sync_dsps, sync => {
        if (sync[0] === type && sync[1]) {
          syncs.push({type, url: sync[1]});
        }
      });
    }
  });
}

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER, NATIVE],

  isBidRequestValid: function(bid) {
    const sortableConfig = config.getConfig('sortable');
    const haveSiteId = (sortableConfig && !!sortableConfig.siteId) || bid.params.siteId;
    const validFloor = !bid.params.floor || utils.isNumber(bid.params.floor);
    const validSize = /\d+x\d+/;
    const validFloorSizeMap = !bid.params.floorSizeMap ||
      (utils.isPlainObject(bid.params.floorSizeMap) &&
        Object.keys(bid.params.floorSizeMap).every(size =>
          size.match(validSize) && utils.isNumber(bid.params.floorSizeMap[size])
        ))
    const validKeywords = !bid.params.keywords ||
      (utils.isPlainObject(bid.params.keywords) &&
        Object.keys(bid.params.keywords).every(key =>
          utils.isStr(key) && utils.isStr(bid.params.keywords[key])
        ))
    return !!(bid.params.tagId && haveSiteId && validFloor && validFloorSizeMap && validKeywords && bid.sizes &&
      bid.sizes.every(sizeArr => sizeArr.length == 2 && sizeArr.every(num => utils.isNumber(num))));
  },

  buildRequests: function(validBidReqs, bidderRequest) {
    const sortableConfig = config.getConfig('sortable') || {};
    const globalSiteId = sortableConfig.siteId;
    let loc = utils.getTopWindowLocation();

    const sortableImps = utils._map(validBidReqs, bid => {
      const rv = {
        id: bid.bidId,
        tagid: bid.params.tagId,
        ext: {}
      };
      const bannerMediaType = utils.deepAccess(bid, `mediaTypes.${BANNER}`);
      const nativeMediaType = utils.deepAccess(bid, `mediaTypes.${NATIVE}`);
      if (bannerMediaType || !nativeMediaType) {
        const bannerSizes = (bannerMediaType && bannerMediaType.sizes) || bid.sizes || [];
        rv.banner = {
          format: utils._map(bannerSizes, ([width, height]) => ({w: width, h: height}))
        };
      }
      if (nativeMediaType) {
        rv.native = buildNativeRequest(nativeMediaType);
      }
      if (bid.params.floor) {
        rv.bidfloor = bid.params.floor;
      }
      if (bid.params.keywords) {
        rv.ext.keywords = bid.params.keywords;
      }
      if (bid.params.bidderParams) {
        utils._each(bid.params.bidderParams, (params, partner) => {
          rv.ext[partner] = params;
        });
      }
      if (bid.params.floorSizeMap) {
        rv.ext.floorSizeMap = bid.params.floorSizeMap;
      }
      return rv;
    });
    const gdprConsent = bidderRequest && bidderRequest.gdprConsent;
    const sortableBidReq = {
      id: utils.getUniqueIdentifierStr(),
      imp: sortableImps,
      site: {
        domain: loc.hostname,
        page: loc.href,
        ref: utils.getTopWindowReferrer(),
        publisher: {
          id: globalSiteId || validBidReqs[0].params.siteId,
        },
        device: {
          w: screen.width,
          h: screen.height
        },
      },
    };
    if (bidderRequest && bidderRequest.timeout > 0) {
      sortableBidReq.tmax = bidderRequest.timeout;
    }
    if (gdprConsent) {
      sortableBidReq.user = {
        ext: {
          consent: gdprConsent.consentString
        }
      };
      sortableBidReq.regs = {
        ext: {
          gdpr: gdprConsent.gdprApplies ? 1 : 0
        }
      };
    }

    return {
      method: 'POST',
      url: `//${SERVER_URL}/openrtb2/auction?src=${REPO_AND_VERSION}&host=${loc.host}`,
      data: JSON.stringify(sortableBidReq),
      options: {contentType: 'text/plain'}
    };
  },

  interpretResponse: function(serverResponse) {
    const { body: {id, seatbid} } = serverResponse;
    const sortableBids = [];
    if (id && seatbid) {
      utils._each(seatbid, seatbid => {
        utils._each(seatbid.bid, bid => {
          const bidObj = {
            requestId: bid.impid,
            cpm: parseFloat(bid.price),
            width: parseInt(bid.w),
            height: parseInt(bid.h),
            creativeId: bid.crid || bid.id,
            dealId: bid.dealid || null,
            currency: 'USD',
            netRevenue: true,
            mediaType: BANNER,
            ttl: 60
          };
          if (bid.adm) {
            const native = tryParseNativeResponse(bid.adm);
            if (native) {
              bidObj.mediaType = NATIVE;
              bidObj.native = interpretNativeResponse(native);
            } else {
              bidObj.mediaType = BANNER;
              bidObj.ad = bid.adm;
              if (bid.nurl) {
                bidObj.ad += utils.createTrackPixelHtml(decodeURIComponent(bid.nurl));
              }
            }
          } else if (bid.nurl) {
            bidObj.adUrl = bid.nurl;
          }
          if (bid.ext) {
            bidObj[BIDDER_CODE] = bid.ext;
          }
          sortableBids.push(bidObj);
        });
      });
    }
    return sortableBids;
  },

  getUserSyncs: (syncOptions, responses) => {
    const syncs = [];
    if (syncOptions.iframeEnabled) {
      transformSyncs(responses, 'iframe', syncs);
    }
    if (syncOptions.pixelEnabled) {
      transformSyncs(responses, 'image', syncs);
    }
    return syncs;
  },

  onTimeout(details) {
    fetch(`//${SERVER_URL}/prebid/timeout`, {
      method: 'POST',
      body: JSON.stringify(details),
      mode: 'no-cors',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    });
  }
};

registerBidder(spec);
