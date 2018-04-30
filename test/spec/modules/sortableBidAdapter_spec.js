import { expect } from 'chai';
import { spec } from 'modules/sortableBidAdapter';
import { newBidder } from 'src/adapters/bidderFactory';
import { REPO_AND_VERSION } from 'src/constants';

const ENDPOINT = `//c.deployads.com/openrtb2/auction?src=${REPO_AND_VERSION}`;

describe('sortableBidAdapter', function() {
  const adapter = newBidder(spec);

  describe('isBidRequestValid', () => {
    let bid = {
      'bidder': 'sortable',
      'params': {
        'tagid': '403370',
        'siteId': 1,
      },
      'adUnitCode': 'adunit-code',
      'sizes': [
        [300, 250]
      ],
      'bidId': '30b31c1838de1e',
      'bidderRequestId': '22edbae2733bf6',
      'auctionId': '1d1a030790a475',
    };

    it('should return true when required params found', () => {
      expect(spec.isBidRequestValid(bid)).to.equal(true);
    });

    it('should return false when tagid not passed correctly', () => {
      delete bid.params.tagid;
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when sizes not passed correctly', () => {
      delete bid.sizes;
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when sizes are wrong length', () => {
      bid.sizes = [[300]];
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });

    it('should return false when require params are not passed', () => {
      let bid = Object.assign({}, bid);
      bid.params = {};
      expect(spec.isBidRequestValid(bid)).to.equal(false);
    });
  });

  describe('buildRequests', () => {
    const bidRequests = [{
      'bidder': 'sortable',
      'params': {
        'tagid': '403370',
        'siteId': 1,
      },
      'sizes': [
        [300, 250]
      ],
      'bidId': '30b31c1838de1e',
      'bidderRequestId': '22edbae2733bf6',
      'auctionId': '1d1a030790a475'
    }];

    const request = spec.buildRequests(bidRequests);
    const requestBody = JSON.parse(request.data);

    it('sends bid request to our endpoint via POST', () => {
      expect(request.method).to.equal('POST');
    });

    it('attaches source and version to endpoint URL as query params', () => {
      expect(request.url).to.equal(ENDPOINT);
    });

    it('sends screen dimensions', () => {
      expect(requestBody.site.device.w).to.equal(800);
      expect(requestBody.site.device.h).to.equal(600);
    });

    it('includes the ad size in the bid request', () => {
      expect(requestBody.imp[0].banner.format[0].w).to.equal(300);
      expect(requestBody.imp[0].banner.format[0].h).to.equal(250);
    });
  });

  describe('interpretResponse', () => {
    let response = {
      body: {
        'id': '5e5c23a5ba71e78',
        'seatbid': [
          {
            'bid': [
              {
                'id': '6vmb3isptf',
                'impid': '322add653672f68',
                'price': 1.22,
                'adm': '<!-- creative -->',
                'attr': [5],
                'h': 90,
                'nurl': 'http://nurl',
                'w': 728
              }
            ],
            'seat': 'MOCK'
          }
        ],
        'bidid': '5e5c23a5ba71e78'
      }
    };

    it('should get the correct bid response', () => {
      let expectedResponse = [{
        'requestId': '322add653672f68',
        'cpm': 1.22,
        'width': 728,
        'height': 90,
        'creativeId': '6vmb3isptf',
        'dealId': null,
        'currency': 'USD',
        'netRevenue': true,
        'mediaType': 'banner',
        'ttl': 60,
        'ad': '<!-- creative --><div style="position:absolute;left:0px;top:0px;visibility:hidden;"><img src="http://nurl"></div>'
      }];

      let result = spec.interpretResponse(response);
      expect(Object.keys(result[0])).to.deep.equal(Object.keys(expectedResponse[0]));
    });

    it('handles empty bid response', () => {
      let response = {
        body: {
          'id': '5e5c23a5ba71e78',
          'seatbid': []
        }
      };
      let result = spec.interpretResponse(response);
      expect(result.length).to.equal(0);
    });
  });
});
