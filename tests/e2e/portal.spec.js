import { expect, test } from '@playwright/test';

const ADMIN_PASS = process.env.E2E_ADMIN_PASS || 'SecPanchayat#2026';
const OFFICER_ID = `ward4_e2e_${Date.now().toString().slice(-5)}`;
const OFFICER_EMAIL = `${OFFICER_ID}@abcpanchayat.gov.in`;
const OFFICER_PASS = 'OfficerWard4#2026';

test.describe('ABC Gram Panchayat — End-to-End Civic & Admin Journeys', () => {
  test('1. Citizen portal loads, toggles EN/ML language, and leaks zero PII on home ledger', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Public Grievance Redressal'
    );

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\b9\d{9}\b/);

    await page.locator('#btn-toggle-lang').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'പൊതുജന പരാതി പരിഹാരവും'
    );

    await page.locator('#btn-toggle-lang').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Public Grievance Redressal'
    );
  });

  test('2. Full Citizen -> Admin -> Officer -> Citizen Feedback & Reopen lifecycle', async ({
    page,
    request,
  }) => {
    // --- Step A: Citizen submits grievance in Ward 4 ---
    await page.goto('/');
    await page.locator('[data-cnav="grievance"]').first().click();

    await page.locator('#grv-name').fill('AnithaKumari E2E');
    await page.locator('#grv-mobile').fill('9847123456');
    await page.locator('#grv-ward').selectOption('4');
    await page.locator('#grv-category').selectOption('Water Supply');
    await page.locator('#grv-priority').selectOption('HIGH');
    await page.locator('#grv-landmark').fill('Ward 4 Anganwadi Pipeline E2E');
    await page
      .locator('#grv-desc')
      .fill('Drinking water main valve leaking continuously near Ward 4 Anganwadi.');
    await page.locator('[data-sample-photo]').first().click();
    await page.locator('#grv-consent').check();
    await page.locator('#citizen-grievance-form button[type="submit"]').click();

    await expect(page.getByText('Official Acknowledgement Slip')).toBeVisible();
    const grvId = (
      await page.locator('.print-only-slip p.font-mono.text-xl').innerText()
    ).trim();
    const grvToken = (
      await page.locator('.print-only-slip p.select-all').innerText()
    ).trim();
    expect(grvId).toMatch(/^ABC-GRV-/);
    expect(grvToken.length).toBeGreaterThan(6);

    // Track via slip button and reload persistence
    await page.locator('#btn-track-submitted-grv').click();
    await expect(page.getByText(grvId)).toBeVisible();
    await expect(page.getByText('Ward 4 Anganwadi Pipeline E2E')).toBeVisible();

    await page.reload();
    await page.locator('[data-cnav="track"]').first().click();
    await page.locator('#tracker-input').fill(grvId);
    await page.locator('#tracker-token-input').fill(grvToken);
    await page.locator('#tracker-last4-input').fill('3456');
    await page.locator('#tracker-search-form button[type="submit"]').click();
    await expect(page.getByText('Ward 4 Anganwadi Pipeline E2E')).toBeVisible();

    // --- Step B: Negative tracking token check ---
    await page.locator('#tracker-token-input').fill('TK-INVALID-9999');
    await page.locator('#tracker-search-form button[type="submit"]').click();
    await expect(page.locator('[role="alert"]')).toBeVisible();

    // --- Step C: Citizen applies for Residence Certificate ---
    await page.locator('[data-cnav="services"]').first().click();
    await page.locator('[data-select-service="residence"]').click();
    await page.locator('#srv-name').fill('Kavitha E2E');
    await page.locator('#srv-mobile').fill('9447123456');
    await page.locator('#srv-ward').selectOption('4');
    await page.locator('#srv-address').fill('House 4/210, Temple Road, Ward 4');
    await page.locator('[data-srv-doc]').first().check();
    await page.locator('#citizen-service-form button[type="submit"]').click();
    await expect(page.getByText('Official Acknowledgement Slip')).toBeVisible();

    // --- Step D: Super Admin bootstrap/login + SLA + staff creation + audit verify ---
    await page.locator('[data-portal-switch="admin"]').click();
    const claimForm = page.locator('#bootstrap-claim-form');
    if (await claimForm.isVisible()) {
      await page.locator('#claim-passcode').fill(ADMIN_PASS);
      await page.locator('#claim-passcode-confirm').fill(ADMIN_PASS);
      await claimForm.locator('button[type="submit"]').click();
    } else {
      await page.locator('#admin-identifier').fill('admin_test');
      await page.locator('#admin-passcode').fill(ADMIN_PASS);
      await page.locator('#admin-login-form button[type="submit"]').click();
    }

    await expect(page.getByText('Executive Governance Dashboard')).toBeVisible();

    // Update SLA policy
    await page.locator('#sla-days-input').fill('8');
    await page.locator('#sla-config-form button[type="submit"]').click();

    // Create scoped Ward 4 officer
    await page.locator('[data-anav="access-control"]').first().click();
    await page.locator('#btn-create-staff').click();
    const staffForm = page.locator('#staff-role-form');
    await staffForm.locator('input[name="name"]').fill('E2E Ward 4 Officer');
    await staffForm.locator('input[name="username"]').fill(OFFICER_ID);
    await staffForm.locator('input[name="email"]').fill(OFFICER_EMAIL);
    await staffForm.locator('input[name="designation"]').fill('Field Overseer');
    await staffForm.locator('select[name="role"]').selectOption('WARD_OFFICER');
    await staffForm.locator('select[name="department"]').selectOption('Water & Sanitation');
    await staffForm.locator('input[name="passcode"]').fill(OFFICER_PASS);
    await page.locator('#btn-wards-clear').click();
    await page.locator('[data-toggle-ward="4"]').click();
    await staffForm.locator('button[type="submit"]').click();
    await expect(page.getByText(OFFICER_EMAIL)).toBeVisible();

    // Verify audit log UI & cryptographic audit verification API
    await page.locator('[data-anav="audit"]').first().click();
    await expect(page.getByText('Immutable System Audit Log')).toBeVisible();
    const verifyRes = await page.evaluate(async () => {
      const r = await fetch('/api/staff/audit/verify', { credentials: 'same-origin' });
      return r.json();
    });
    expect(verifyRes.ok).toBe(true);
    expect(verifyRes.integrity?.ok).toBe(true);

    // Sign out admin
    await page.locator('#btn-admin-logout').click();
    await expect(page.locator('#admin-login-form')).toBeVisible();

    // --- Step E: Negative invalid login check ---
    await page.locator('#admin-identifier').fill(OFFICER_ID);
    await page.locator('#admin-passcode').fill('WrongPass123!');
    await page.locator('#admin-login-form button[type="submit"]').click();
    await expect(page.locator('#admin-login-error')).toBeVisible();

    // --- Step F: Ward Officer signs in, resolves Ward 4 grievance with proof ---
    await page.locator('#admin-identifier').fill(OFFICER_ID);
    await page.locator('#admin-passcode').fill(OFFICER_PASS);
    await page.locator('#admin-login-form button[type="submit"]').click();
    await expect(page.getByText('Executive Governance Dashboard')).toBeVisible();

    // Ward Officer must not see Access & Roles navigation
    await expect(page.locator('[data-anav="access-control"]')).toHaveCount(0);

    await page.locator('[data-anav="grievances"]').first().click();
    await page.locator(`[data-open-grv="${grvId}"]`).first().click();
    const grvForm = page.locator('#drawer-grv-form');
    await grvForm.locator('select[name="status"]').selectOption('IN_PROGRESS');
    await grvForm.locator('textarea[name="publicRemark"]').fill('Inspection team dispatched to Ward 4.');
    await grvForm.locator('button[type="submit"]').click();

    await page.locator('#drawer-comment-form textarea[name="body"]').fill('Pipeline clamp replaced.');
    await page.locator('#drawer-comment-form button[type="submit"]').click();
    await expect(page.getByText('Pipeline clamp replaced.')).toBeVisible();

    await grvForm.locator('select[name="status"]').selectOption('RESOLVED');
    await grvForm
      .locator('textarea[name="publicRemark"]')
      .fill('Leak repaired and pressure verified normal.');
    await page.locator('[data-attach-proof]').first().click();
    await grvForm.locator('button[type="submit"]').click();
    await page.locator('#btn-close-detail-drawer').click();
    await page.locator('#btn-admin-logout').click();

    // --- Step G: Citizen views resolved proof, submits rating & reopens ---
    await page.locator('[data-portal-switch="citizen"]').click();
    await page.locator('[data-cnav="track"]').first().click();
    await page.locator('#tracker-input').fill(grvId);
    await page.locator('#tracker-token-input').fill(grvToken);
    await page.locator('#tracker-last4-input').fill('3456');
    await page.locator('#tracker-search-form button[type="submit"]').click();

    await expect(page.getByText('Verified Resolution Proof')).toBeVisible();
    await page.locator('[data-star="5"]').click();
    await page.locator('#feedback-comment').fill('Fast repair by Ward 4 team.');
    await page.locator('#citizen-feedback-form button[type="submit"]').click();
    await expect(page.getByText('Thank you! Your citizen feedback has been recorded.')).toBeVisible();

    await page
      .locator('#reopen-reason-input')
      .fill('Minor seepage noticed again at evening supply hour.');
    await page.locator('#citizen-reopen-form button[type="submit"]').click();
    await expect(page.getByText('Reopened')).toBeVisible();

    // Sanity check health API
    const health = await request.get('/api/health');
    expect(health.ok()).toBe(true);
  });

  test('3. Mobile responsive menu opens cleanly on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menuBtn = page.locator('#btn-citizen-mobile-menu');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await expect(page.locator('[data-cnav="grievance"]').last()).toBeVisible();
  });
});
