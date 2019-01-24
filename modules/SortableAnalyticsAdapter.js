import adapter from 'src/AnalyticsAdapter';
import CONSTANTS from 'src/constants.json';
import adaptermanager from 'src/adaptermanager';
import * as utils from 'src/utils';
import {ajaxBuilder} from 'src/ajax';
import {getGlobal} from 'src/prebidGlobal';

const ajax = ajaxBuilder(0);

const SESSION_STORAGE_PREFIX = 'ssrt_utm_sa4p_';
const DEFAULT_HOST = 'e.deployads.com';
const DEFAULT_URL = `//${DEFAULT_HOST}/e`;
const ANALYTICS_TYPE = 'endpoint';

const UTM_STORE_KEY = 'utm';

const settings = {};
const {
  EVENTS: {
    AUCTION_INIT,
    AUCTION_END,
    BID_REQUESTED,
    BID_ADJUSTMENT,
    BID_WON,
    BID_TIMEOUT,
  }
} = CONSTANTS;

const minsToMillis = mins => mins * 60 * 1000;
const UTM_TTL = minsToMillis(30);

const SORTABLE_EVENTS = {
  AUCTION_INIT: 'pbai',
  BID_REQUEST: 'pbr',
  BID_RECEIVED: 'pbrv',
  BID_WON: 'pbrw',
  BID_TIMEOUT: 'pbto',
  ERROR: 'pber',
  PB_BID: 'pbid'
};

const DEVICE_TYPE = {
  DESKTOP: 'D',
  TABLET: 'T',
  SMARTPHONE: 'S',
  UNKNOWN: 'U'
};

const UTM_PARAMS = [
  'utm_campaign',
  'utm_source',
  'utm_medium',
  'utm_content',
  'utm_term'
];

const EVENT_KEYS_SHORT_NAMES = {
  'auctionId': 'ai',
  'adUnitCode': 'ac',
  'adId': 'adi',
  'bidderAlias': 'bs',
  'bidFactor': 'bif',
  'bidId': 'bid',
  'bidRequestCount': 'brc',
  'bidderRequestId': 'brid',
  'bidRequestedSizes': 'rs',
  'bidTopCpm': 'btcp',
  'bidTopCpmCurrency': 'btcc',
  'bidTopIsNetRevenue': 'btin',
  'bidTopFactor': 'btif',
  'cpm': 'c',
  'currency': 'cc',
  'dealId': 'did',
  'isNetRevenue': 'inr',
  'isTop': 'it',
  'isTimeout': 'ito',
  'mediaType': 'mt',
  'reachedTop': 'rtp',
  'numIframes': 'nif',
  'size': 'siz',
  'start': 'st',
  'tagId': 'tgid',
  'transactionId': 'trid',
  'ttl': 'ttl',
  'ttr': 'ttr',
  'url': 'u',
  'utm_campaign': 'uc',
  'utm_source': 'us',
  'utm_medium': 'um',
  'utm_content': 'un',
  'utm_term': 'ut'
};

const auctionCache = {};

let bidderFactors = null;

const TIMEOUT_FOR_EVENTS = 1000;
let timeoutId = null;
let eventsToBeSent = [];

function getStorage() {
  try {
    return window['sessionStorage'];
  } catch (e) {
    return null;
  }
}

function getPrefixedKey(k) {
  return `${SESSION_STORAGE_PREFIX}${k}`;
}

function putParams(k, v) {
  try {
    const storage = getStorage();
    if (!storage) {
      return false;
    }
    if (v === null) {
      storage.removeItem(getPrefixedKey(k));
    } else {
      storage.setItem(getPrefixedKey(k), JSON.stringify(v));
    }
    return true;
  } catch (e) {
    return false;
  }
}

function getParams(k) {
  try {
    let storage = getStorage();
    if (!storage) {
      return null;
    }
    let value = storage.getItem(getPrefixedKey(k));
    return value === null ? null : JSON.parse(value);
  } catch (e) {
    return null;
  }
}

function detectDeviceType(userAgent) {
  if (!userAgent) {
    return DEVICE_TYPE.UNKNOWN;
  }
  if (/Mobi|Opera Mini|BlackBerry/i.test(userAgent)) {
    if (/TABLET|iPad/i.test(userAgent)) {
      return DEVICE_TYPE.TABLET;
    }
    return DEVICE_TYPE.SMARTPHONE;
  }
  if (/TABLET|Android|Silk/i.test(userAgent)) {
    return DEVICE_TYPE.TABLET;
  }
  return DEVICE_TYPE.DESKTOP;
}

function storeParams(key, paramsToSave) {
  if (!settings.disableSessionTracking) {
    for (let property in paramsToSave) {
      if (paramsToSave.hasOwnProperty(property)) {
        putParams(key, paramsToSave);
        break;
      }
    }
  }
}

function generateRandomId() {
  let s = (+new Date()).toString(36);
  for (let i = 0; i < 6; ++i) { s += (Math.random() * 36 | 0).toString(36); }
  return s;
}

function getUserId() {
  const getCookie = utils.getCookie || (name => {
    if (utils.cookiesAreEnabled()) {
      let m = window.document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]*)\\s*(;|$)');
      return m ? decodeURIComponent(m[2]) : null;
    } else {
      return null
    }
  });
  return getCookie('d7s_uid');
}

function getSessionParams() {
  const stillValid = paramsFromStorage => (paramsFromStorage.created) < (+new Date() + UTM_TTL);
  let sessionParams = null;
  if (!settings.disableSessionTracking) {
    const paramsFromStorage = getParams(UTM_STORE_KEY);
    sessionParams = paramsFromStorage && stillValid(paramsFromStorage) ? paramsFromStorage : null;
  }
  sessionParams = sessionParams || {'created': +new Date(), 'sessionId': generateRandomId()};
  const urlParams = UTM_PARAMS.map(utils.getParameterByName);
  if (UTM_PARAMS.every(key => !sessionParams[key])) {
    UTM_PARAMS.forEach((v, i) => sessionParams[v] = urlParams[i] || sessionParams[v]);
    sessionParams.created = +new Date();
    storeParams(UTM_STORE_KEY, sessionParams);
  }
  return sessionParams;
}

function getPrebidVersion() {
  return getGlobal().version;
}

function getUserAgent() {
  return navigator && navigator.userAgent;
}

function getFactor(bidder) {
  if (bidder && bidder.bidCpmAdjustment) {
    return bidder.bidCpmAdjustment(1.0);
  } else {
    return null;
  }
}

function getBiddersFactors() {
  const pb = getGlobal();
  const result = {};
  if (pb && pb.bidderSettings) {
    Object.keys(pb.bidderSettings).forEach(bidderKey => {
      const bidder = pb.bidderSettings[bidderKey];
      const factor = getFactor(bidder);
      if (factor !== null) {
        result[bidderKey] = factor;
      }
    });
  }
  return result;
}

function getBaseEvent(auctionId, adUnitCode, bidderCode) {
  const event = {};
  event['s'] = settings.key;
  event['ai'] = auctionId;
  event['ac'] = adUnitCode;
  event['bs'] = bidderCode;
  return event;
}

function getBidBaseEvent(auctionId, adUnitCode, bidderCode) {
  const sessionParams = getSessionParams();
  const userId = getUserId();
  const prebidVersion = getPrebidVersion();
  const event = getBaseEvent(auctionId, adUnitCode, bidderCode);
  event['cfdt'] = settings.deviceType;
  event['sid'] = sessionParams.sessionId;
  if (userId) event['uid'] = userId;
  event['pv'] = settings.pageviewId;
  event['to'] = auctionCache[auctionId].timeout;
  event['pbv'] = prebidVersion;
  UTM_PARAMS.filter(k => sessionParams[k]).forEach(k => event[EVENT_KEYS_SHORT_NAMES[k]] = sessionParams[k]);
  return event;
}

function createPBBidEvent(bid) {
  const event = getBidBaseEvent(bid.auctionId, bid.adUnitCode, bid.bidderAlias);
  const orphanKeys = [];
  Object.keys(bid).forEach(k => {
    const shortName = EVENT_KEYS_SHORT_NAMES[k];
    if (!shortName) {
      orphanKeys.push(k);
    } else {
      event[shortName] = bid[k];
    }
  });
  if (orphanKeys.length) {
    handleError(SORTABLE_EVENTS.ERROR, bid, {'message': `Short name not found for ${orphanKeys.join(',')}`});
  }
  event['_type'] = SORTABLE_EVENTS.PB_BID;
  return event;
}

function getBidFactor(bidderAlias) {
  if (!bidderFactors) {
    bidderFactors = getBiddersFactors();
  }
  const factor = bidderFactors[bidderAlias];
  return typeof factor !== 'undefined' ? factor : 1.0;
}

function createPrebidBidWonEvent({auctionId, adUnitCode, bidderAlias, cpm, currency, isNetRevenue}) {
  const bidFactor = getBidFactor(bidderAlias);
  const event = getBaseEvent(auctionId, adUnitCode, bidderAlias);
  event['bif'] = bidFactor;
  event['cpm'] = cpm;
  event['cc'] = currency;
  event['inr'] = isNetRevenue;
  event['_type'] = SORTABLE_EVENTS.BID_WON;
  return event;
}

function createPrebidTimeoutEvent({auctionId, adUnitCode, bidderAlias}) {
  const event = getBaseEvent(auctionId, adUnitCode, bidderAlias);
  event['_type'] = SORTABLE_EVENTS.BID_TIMEOUT;
  return event;
}

function groupBy(list, keyGetterFn) {
  const map = {};
  list.forEach(item => {
    const key = keyGetterFn(item);
    map[key] = map[key] ? [...map[key], item] : [item];
  });
  return map;
}

function mergeAndCompressEventsByType(events, type) {
  if (!events.length) {
    return null;
  }
  const allKeys = [...new Set(events.map(ev => Object.keys(ev)).reduce((prev, curr) => [...prev, ...curr], []))];
  const eventsAsMap = {};
  allKeys.forEach(k => {
    events.forEach(ev => eventsAsMap[k] = eventsAsMap[k] ? [...eventsAsMap[k], ev[k]] : [ev[k]]);
  });
  const allSame = arr => arr.every(el => arr[0] === el);
  Object.keys(eventsAsMap)
    .forEach(k => eventsAsMap[k] = (eventsAsMap[k].length && allSame(eventsAsMap[k])) ? eventsAsMap[k][0] : eventsAsMap[k]);
  eventsAsMap['_count'] = events.length;
  const result = {};
  result[type] = eventsAsMap;
  return result;
}

function mergeAndCompressEvents(events) {
  const types = [...new Set(events.map(e => e['_type']))];
  const groupedEvents = groupBy(events, e => e['_type']);
  const results = types.map(t => groupedEvents[t])
    .map(events => mergeAndCompressEventsByType(events, events[0]['_type']));
  return results.reduce((prev, eventMap) => {
    const key = Object.keys(eventMap)[0];
    prev[key] = eventMap[key];
    return prev;
  }, {});
}

function registerEvents(events) {
  eventsToBeSent = [...eventsToBeSent, ...events];
  if (!timeoutId) {
    timeoutId = setTimeout(() => {
      const _eventsToBeSent = eventsToBeSent.slice();
      eventsToBeSent = [];
      sendEvents(_eventsToBeSent);
    }, TIMEOUT_FOR_EVENTS);
  }
}

function sendEvents(events) {
  timeoutId = null;
  const url = settings.url;
  const mergedEvents = mergeAndCompressEvents(events);
  const headers = {
    'contentType': 'text/plain',
    'method': 'POST'
  };
  const onSend = () => utils.logInfo('Data Sent');
  ajax(url, onSend, JSON.stringify(mergedEvents), headers)
}

function sizesToString(sizes) {
  return sizes.map(s => s.join('x')).join(',');
}

function handleBidRequested(event) {
  const refererInfo = event.refererInfo;
  const url = refererInfo ? refererInfo.referer : utils.getTopWindowUrl();
  const reachedTop = refererInfo ? refererInfo.reachedTop : !!utils.getTopWindowUrl();
  const numIframes = refererInfo ? refererInfo.numIframes : 0;
  event.bids.forEach(bid => {
    const auctionId = bid.auctionId;
    const adUnitCode = bid.adUnitCode;
    const tagId = bid.bidder === 'sortable' ? bid.params.tagId : '';
    if (!auctionCache[auctionId].adUnits[adUnitCode]) {
      auctionCache[auctionId].adUnits[adUnitCode] = {bids: {}};
    }
    const adUnit = auctionCache[auctionId].adUnits[adUnitCode];
    const bids = adUnit.bids;
    const newBid = {
      adUnitCode: bid.adUnitCode,
      auctionId: event.auctionId,
      bidderAlias: bid.bidder,
      bidId: bid.bidId,
      bidderRequestId: bid.bidderRequestId,
      bidRequestCount: bid.bidRequestCount,
      bidRequestedSizes: sizesToString(bid.sizes),
      currency: bid.currency,
      cpm: 0.0,
      isTimeout: false,
      isTop: false,
      numIframes: numIframes,
      start: event.start,
      tagId: tagId,
      transactionId: bid.transactionId,
      reachedTop: reachedTop,
      url: encodeURI(url)
    };
    bids[newBid.bidderAlias] = newBid;
  });
}

function handleBidAdjustment(event) {
  const auctionId = event.auctionId;
  const adUnitCode = event.adUnitCode;
  const adUnit = auctionCache[auctionId].adUnits[adUnitCode];
  const bid = adUnit.bids[event.bidderCode];
  const bidFactor = getBidFactor(event.bidderCode);
  bid.adId = event.adId;
  bid.adUnitCode = event.adUnitCode;
  bid.auctionId = event.auctionId;
  bid.bidderAlias = event.bidderCode;
  bid.bidFactor = bidFactor;
  bid.cpm = event.cpm;
  bid.currency = event.currency;
  bid.dealId = event.dealId;
  bid.isNetRevenue = event.isNetRevenue;
  bid.mediaType = event.mediaType;
  bid.size = event.getSize();
  bid.ttl = event.ttl;
  bid.ttr = event.timeToRespond;
}

function handleBidWon(event) {
  const auctionId = event.auctionId;
  const adUnitCode = event.adUnitCode;
  const adUnit = auctionCache[auctionId].adUnits[adUnitCode];
  const auction = auctionCache[auctionId];
  const bidFactor = getBidFactor(event.bidderCode);
  if (!auction.sent) {
    Object.keys(adUnit.bids).forEach(bidderCode => {
      const bidFromUnit = adUnit.bids[bidderCode];
      bidFromUnit.bidTopFactor = bidFactor;
      bidFromUnit.bidTopCpm = event.cpm;
      bidFromUnit.bidTopCpmCurrency = event.currency;
      bidFromUnit.bidTopIsNetRevenue = event.netRevenue;
      bidFromUnit.isTop = event.bidderCode === bidderCode;
    });
  } else {
    const ev = createPrebidBidWonEvent({
      adUnitCode: event.adUnitCode,
      auctionId: event.auctionId,
      bidderAlias: event.bidderCode,
      currency: event.currency,
      cpm: event.cpm,
      isNetRevenue: event.isNetRevenue,
    });
    registerEvents([ev]);
  }
}

function handleBidTimeout(event) {
  event.forEach(timeout => {
    const auctionId = timeout.auctionId;
    const adUnitCode = timeout.adUnitCode;
    const bidderAlias = timeout.bidder;
    const auction = auctionCache[auctionId];
    if (!auction.sent) {
      const adUnit = auction.adUnits[adUnitCode];
      const bid = adUnit.bids[bidderAlias];
      bid.isTimeout = true;
    } else {
      const event = createPrebidTimeoutEvent({auctionId, adUnitCode, bidderAlias});
      registerEvents([event]);
    }
  });
}

function handleAuctionInit(event) {
  const auctionId = event.auctionId;
  const timeout = event.timeout;
  auctionCache[auctionId] = {timeout: timeout, auctionId: auctionId, adUnits: {}};
}
function handleAuctionEnd(event) {
  setTimeout(() => {
    const auction = auctionCache[event.auctionId];
    const events = Object.keys(auction.adUnits).map(adUnitCode => {
      return Object.keys(auction.adUnits[adUnitCode].bids).map(bidderCode => {
        const bid = auction.adUnits[adUnitCode].bids[bidderCode];
        return createPBBidEvent(bid);
      })
    }).reduce((prev, curr) => [...prev, ...curr], []);
    sendEvents(events);
    auction.sent = true;
  }, TIMEOUT_FOR_EVENTS);
}

function handleError(eventType, event, e) {
  const ev = {};
  event['s'] = settings.key;
  event['ti'] = eventType;
  event['args'] = JSON.stringify(event);
  event['msg'] = e.message;
  event['_type'] = SORTABLE_EVENTS.ERROR;
  registerEvents([ev]);
}

const sortableAdapter = Object.assign(adapter({url: DEFAULT_URL, ANALYTICS_TYPE}), {
  track({eventType, args}) {
    try {
      switch (eventType) {
        case AUCTION_INIT:
          handleAuctionInit(args);
          break;
        case AUCTION_END:
          handleAuctionEnd(args);
          break;
        case BID_REQUESTED:
          handleBidRequested(args);
          break;
        case BID_ADJUSTMENT:
          handleBidAdjustment(args);
          break;
        case BID_WON:
          handleBidWon(args);
          break;
        case BID_TIMEOUT:
          handleBidTimeout(args);
          break;
      }
    } catch (e) {
      handleError(eventType, args, e);
    }
  },
});

sortableAdapter.originEnableAnalytics = sortableAdapter.enableAnalytics;

sortableAdapter.enableAnalytics = function (config) {
  if (this.initConfig(config)) {
    utils.logInfo('Sortable Analytics adapter enabled');
    sortableAdapter.originEnableAnalytics(config);
  }
};

sortableAdapter.initConfig = function (config) {
  settings.deviceType = detectDeviceType(getUserAgent());
  settings.disableSessionTracking = config.disableSessionTracking === undefined ? false : config.disableSessionTracking;
  settings.key = config.options.key;
  settings.url = `//${config.options.eventHost || DEFAULT_HOST}/e/${settings.key}`;
  settings.pageviewId = generateRandomId();
  return !!settings.key;
};

sortableAdapter.getOptions = function () {
  return settings;
};

adaptermanager.registerAnalyticsAdapter({
  adapter: sortableAdapter,
  code: 'sortable'
});

export default sortableAdapter;
