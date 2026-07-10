#!/usr/bin/env node
/**
 * Live smoke test against running backend (default http://localhost:3001).
 * Uses session-only env credentials — never logs secrets.
 */

require('dotenv').config();

const BASE_URL = process.env.SMOKE_TEST_API_BASE_URL || 'http://localhost:3001';
const EMAIL =
  process.env.MBH_TEST_VENDOR_EMAIL ||
  process.env.SMOKE_TEST_VENDOR_EMAIL;
const PASSWORD =
  process.env.MBH_TEST_VENDOR_PASSWORD ||
  process.env.SMOKE_TEST_VENDOR_PASSWORD;

function assertCondition(label, ok, details = '') {
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${label}${details ? ` — ${details}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function getCookieHeader(setCookie) {
  if (!setCookie) return '';
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  return headers.map((entry) => entry.split(';')[0]).join('; ');
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await parseJson(res);
  return {
    ok: res.status === 200,
    status: res.status,
    body,
    cookie: getCookieHeader(res.headers.getSetCookie?.() || res.headers.raw?.()['set-cookie']),
  };
}

async function authedFetch(path, { method = 'GET', cookie, body } = {}) {
  const headers = { cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await parseJson(res) };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Missing MBH_TEST_VENDOR_EMAIL/PASSWORD or SMOKE_TEST_VENDOR_* env vars.');
    process.exit(1);
  }

  console.log(`Live listing-price smoke against ${BASE_URL}`);

  const session = await login();
  assertCondition('Vendor login', session.ok, `status=${session.status}`);
  if (!session.ok) return;

  const myBusinesses = await authedFetch('/api/business/my', { cookie: session.cookie });
  assertCondition('Load vendor businesses', myBusinesses.status === 200);
  const foodBusiness = (myBusinesses.body?.businesses || []).find(
    (item) => item.listingType === 'food'
  );

  if (!foodBusiness) {
    console.log('[SKIP] No food vendor business on this account — food-specific live checks skipped.');
  } else {
    const foodsRes = await authedFetch('/api/food/my-foods', { cookie: session.cookie });
    assertCondition('Load vendor foods', foodsRes.status === 200);

    const categoryId = foodBusiness.categoryId || foodBusiness.categories?.[0]?.categoryId;
    const subcategoryId = foodBusiness.subcategoryId || foodBusiness.categories?.[0]?.subcategoryIds?.[0];

    const zeroPublishAttempt = await authedFetch('/api/food/add-food', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        title: `Smoke Zero Price ${Date.now()}`,
        description: 'Should be rejected at publish',
        price: 0,
        businessId: foodBusiness._id,
        categoryId,
        subcategoryId,
        isPublished: true,
      },
    });
    assertCondition(
      'Block publish on zero-price food create',
      zeroPublishAttempt.status === 400 &&
        zeroPublishAttempt.body?.code === 'LISTING_PRICE_REQUIRED',
      `status=${zeroPublishAttempt.status} code=${zeroPublishAttempt.body?.code || 'n/a'}`
    );

    const draftSave = await authedFetch('/api/food/add-food', {
      method: 'POST',
      cookie: session.cookie,
      body: {
        title: `Smoke Draft Zero ${Date.now()}`,
        description: 'Draft save should work',
        price: 0,
        businessId: foodBusiness._id,
        categoryId,
        subcategoryId,
        isPublished: false,
      },
    });
    assertCondition(
      'Allow draft save with zero price',
      draftSave.status === 201 && draftSave.body?.food?.isPublished === false,
      `status=${draftSave.status}`
    );

    if (draftSave.body?.food?._id) {
      const blockedPublishUpdate = await authedFetch(
        `/api/food/update-food/${draftSave.body.food._id}`,
        {
          method: 'PUT',
          cookie: session.cookie,
          body: { isPublished: true, price: 0 },
        }
      );
      assertCondition(
        'Block publish on zero-price food update',
        blockedPublishUpdate.status === 400 &&
          blockedPublishUpdate.body?.code === 'LISTING_PRICE_REQUIRED',
        `status=${blockedPublishUpdate.status} code=${blockedPublishUpdate.body?.code || 'n/a'}`
      );

      const allowedPublishUpdate = await authedFetch(
        `/api/food/update-food/${draftSave.body.food._id}`,
        {
          method: 'PUT',
          cookie: session.cookie,
          body: { isPublished: true, price: 12.99 },
        }
      );
      assertCondition(
        'Allow publish when price is positive',
        allowedPublishUpdate.status === 200 &&
          allowedPublishUpdate.body?.food?.isPublished === true &&
          Number(allowedPublishUpdate.body?.food?.price) > 0,
        `status=${allowedPublishUpdate.status}`
      );
    }

    const zeroOnlyListing = (foodsRes.body?.foods || []).find(
      (food) => Number(food.price) <= 0 && food.isPublished === true
    );
    if (zeroOnlyListing) {
      const publicFood = await fetch(`${BASE_URL}/api/public/foods/${zeroOnlyListing._id}`);
      const publicBody = await parseJson(publicFood);
      assertCondition(
        'Public food DTO avoids Contact-for-price label on zero/missing price',
        publicFood.status === 200 &&
          publicBody?.data?.priceLabel == null &&
          publicBody?.data?.displayPrice == null,
        `status=${publicFood.status} priceLabel=${publicBody?.data?.priceLabel}`
      );
    } else {
      console.log('[INFO] No currently published zero-price food found on this account.');
    }
  }

  if (process.exitCode) {
    console.log('\nLive smoke finished with failures.');
  } else {
    console.log('\nLive smoke finished successfully.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
