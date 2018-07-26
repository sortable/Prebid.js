import * as utils from 'src/utils';
import { registerBidder } from 'src/adapters/bidderFactory';
import { config } from 'src/config';
import { BANNER } from 'src/mediaTypes';
import { REPO_AND_VERSION } from 'src/constants';

const BIDDER_CODE = 'sortable';
const SERVER_URL = 'c.deployads.com';

export const spec = {
  code: BIDDER_CODE,
  supportedMediaTypes: [BANNER],

  isBidRequestValid: function(bid) {
    const sortableConfig = config.getConfig('sortable');
    const haveSiteId = (sortableConfig && !!sortableConfig.siteId) || bid.params.siteId;
    return !!(bid.params.tagId && haveSiteId && bid.sizes &&
      bid.sizes.every(sizeArr => sizeArr.length == 2 && sizeArr.every(num => utils.isNumber(num))));
  },

  buildRequests: function(validBidReqs, bidderRequest) {
    const sortableConfig = config.getConfig('sortable') || {};
    const globalSiteId = sortableConfig.siteId;
    let loc = utils.getTopWindowLocation();

    const sortableImps = utils._map(validBidReqs, bid => {
      let rv = {
        id: bid.bidId,
        tagid: bid.params.tagId,
        banner: {
          format: utils._map(bid.sizes, ([width, height]) => ({w: width, h: height}))
        },
        ext: {}
      };
      if (bid.params.floor) {
        rv.bidfloor = bid.params.floor;
      }
      if (bid.params.keywords) {
        let keywords = utils._map(bid.params.keywords, (foo, bar) => ({name: bar, value: foo}));
        rv.ext.keywords = keywords;
      }
      if (bid.params.bidderParams) {
        utils._each(bid.params.bidderParams, (params, partner) => {
          rv.ext[partner] = params;
        });
      }
      return rv;
    });
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
            creativeId: bid.id,
            dealId: bid.dealid || null,
            currency: 'USD',
            netRevenue: true,
            mediaType: BANNER,
            ttl: 60
          };
          if (bid.adm && bid.nurl) {
            bidObj.ad = bid.adm;
            bidObj.ad += utils.createTrackPixelHtml(decodeURIComponent(bid.nurl));
          } else if (bid.adm) {
            bidObj.ad = bid.adm;
          } else if (bid.nurl) {
            bidObj.adUrl = bid.nurl;
          }
          sortableBids.push(bidObj);
        });
      });
    }
    return sortableBids;
  },

  getUserSyncs: (syncOptions, responses) => {
    const sortableConfig = config.getConfig('sortable');
    if (syncOptions.iframeEnabled && sortableConfig && !!sortableConfig.siteId) {
      let syncUrl = `//${SERVER_URL}/sync?f=html&s=${sortableConfig.siteId}&u=${encodeURIComponent(utils.getTopWindowLocation())}`;
      return [{
        type: 'iframe',
        url: syncUrl
      }];
    }
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
