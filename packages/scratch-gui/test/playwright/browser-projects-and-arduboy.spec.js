// @ts-check
const {test, expect} = require('@playwright/test');

const openFileMenuItem = async (page, label) => {
    await page.getByRole('button', {name: 'File menu'}).click();
    await page.getByText(label, {exact: true}).click();
};

test('projects can be saved in the browser and opened again after a reload', async ({page}) => {
    await page.goto('index.html');
    const title = page.locator('input[class*="title-field"]');
    await title.fill('Browser storage test');
    await title.press('Enter');

    await openFileMenuItem(page, 'Projects saved in this browser');
    const dialog = page.locator('#browserProjectsModal').or(page.getByRole('dialog'));
    await expect(dialog.getByRole('textbox')).toHaveValue('Browser storage test');
    await dialog.getByRole('button', {name: 'Save current project'}).click();
    await expect(dialog.getByText('Browser storage test', {exact: true})).toBeVisible();

    await page.reload();
    await expect(title).toHaveValue('Scratch Project');

    await openFileMenuItem(page, 'Projects saved in this browser');
    await dialog.getByRole('button', {name: 'Open'}).click();
    await expect(title).toHaveValue('Browser storage test');
    await expect(dialog).toBeHidden();

    page.on('dialog', confirmDialog => confirmDialog.accept());
    await openFileMenuItem(page, 'Projects saved in this browser');
    await dialog.getByRole('button', {name: 'Delete'}).click();
    await expect(dialog.getByText('No projects are saved in this browser yet.')).toBeVisible();
});

test('the Arduboy dialog lists the supported hardware', async ({page}) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.stack || err.message || String(err)));
    await page.goto('index.html');
    await openFileMenuItem(page, 'Upload to Arduboy');
    const device = page.getByLabel('Device');
    await expect(device.locator('option')).toHaveText([
        'Arduboy (official hardware)',
        'Pro Micro + SH1106 SPI (standard wiring)',
        'Pro Micro + SH1106 SPI (alternate wiring)'
    ]);
    await expect(page.getByRole('button', {name: 'Download firmware (.hex)'})).toBeEnabled();
    // The compiler worker can't start from file:// URLs, which must not break the dialog.
    expect(pageErrors).toEqual([]);
});
