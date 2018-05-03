# Overview

```
Module Name: Sortable Bid Adapter
Module Type: Bidder Adapter
Maintainer: prebid@sortable.com
```

# Description

Sortable's adapter integration to the Prebid library. Posts plain-text JSON to the /openrtb2/auction endpoint.

# Test Parameters

```
var adUnits = [
  {
    code: 'test-pb-leaderboard',
    sizes: [[728, 90]],
    bids: [{
      bidder: 'sortable',
      params: {
        tagid: 'test-pb-leaderboard',
        siteId: 1
      }
    }]
  }, {
    code: 'test-pb-banner',
    sizes: [[300, 250]],
    bids: [{
      bidder: 'sortable',
      params: {
        tagid: 'test-pb-banner',
        siteId: 1
      }
    }]
  }, {
    code: 'test-pb-sidebar',
    size: [[160, 600]],
    bids: [{
      bidder: 'sortable',
      params: {
        tagid: 'test-pb-sidebar',
        siteId: 1
      }
    }]
  }
]
```
