import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { queryAmount, queryDirection, queryLeverage, tenths } from './what-if';

describe('what-if query', () => {
  it('lists leverage in 0.1x steps without float drift', () => {
    assert.deepEqual(tenths(1, 1.5), [1, 1.1, 1.2, 1.3, 1.4, 1.5]);
    assert.equal(tenths(0.1, 3).length, 30);
    assert.equal(tenths(0.1, 3)[2], 0.3);
  });

  it('snaps a typed leverage to the grid and the range', () => {
    assert.equal(queryLeverage({ l: '1.27' }, 'l', 1, 5, 1), 1.3);
    assert.equal(queryLeverage({ l: '9' }, 'l', 1, 5, 1), 5);
    assert.equal(queryLeverage({ l: 'x' }, 'l', 1, 5, 2), 2);
    assert.equal(queryLeverage({}, 'l', 0.1, 3, 1), 1);
  });

  it('reads short only when asked, and positive amounts only', () => {
    assert.equal(queryDirection({ d: 'short' }, 'd'), 'short');
    assert.equal(queryDirection({ d: 'sideways' }, 'd'), 'long');
    assert.equal(queryAmount({ m: '-5' }, 'm', 100), 100);
    assert.equal(queryAmount({ m: '2500' }, 'm', 100), 2500);
  });
});
