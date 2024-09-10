import { expect, test } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables from the .env file
dotenv.config(); // Make sure this is included

test.describe('Attributes Data Upload with Azure AD Login', () => {
  test.beforeEach(async ({ page }) => {
    // Log environment variables to verify they are loaded (for debugging)
    console.log('Azure AD User Email:', process.env.AZURE_AD_USER_EMAIL);
    console.log('Azure AD User Password:', process.env.AZURE_AD_USER_PASSWORD);

    // Step 1: Log in to the website using Azure AD
    await page.goto('/api/auth/signin');

    // Fill in the Azure AD login details using environment variables
    await page.fill('input[name="loginfmt"]', process.env.AZURE_AD_USER_EMAIL!);
    await page.click('input[type="submit"]');

    // Wait for the password field and input the password
    await page.fill('input[name="passwd"]', process.env.AZURE_AD_USER_PASSWORD!);
    await page.click('input[type="submit"]');

    // Handle any additional Azure AD prompts like "Stay signed in?"
    const staySignedInButton = page.locator('input[id="idSIButton9"]');
    if (await staySignedInButton.isVisible()) {
      await staySignedInButton.click();
    }

    // Step 2: Wait for the session to be authenticated
    await page.waitForURL('/dashboard'); // Assuming the user is redirected to /dashboard after login

    // Step 3: Select a Site, Plot, and Census using dropdowns
    // Select Site
    const siteSelect = await page.locator('.site-select'); // Adjust the selector if needed
    await siteSelect.click();
    await page.click('text="Testing"'); // Replace "Test Site" with the actual site name you want to select

    // Select Plot
    const plotSelect = await page.locator('.plot-selection'); // Adjust the selector if needed
    await plotSelect.click();
    await page.click('text="testing"'); // Replace "Test Plot" with the actual plot name you want to select

    // Select Census
    const censusSelect = await page.locator('.census-select'); // Adjust the selector if needed
    await censusSelect.click();
    await page.click('text="Census: 1"');

    // Step 4: Navigate to /fixeddatainput/attributes
    await page.goto('/fixeddatainput/attributes');
  });

  test('should open and close the upload modal', async ({ page }) => {
    // Navigate to the page where your component is rendered
    await page.goto('/path-to-your-component'); // Adjust this URL as needed

    // Ensure the 'Upload' button is present
    const uploadButton = await page.locator('button:has-text("Upload")');
    await expect(uploadButton).toBeVisible();

    // Click the 'Upload' button
    await uploadButton.click();

    // Check if the modal is open by looking for the modal's container or some text inside
    const uploadModal = await page.locator('text=Upload'); // Adjust selector to match your modal's content
    await expect(uploadModal).toBeVisible();

    // Close the modal (assuming there's a 'Close' button or a way to close the modal)
    const closeModalButton = await page.locator('button:has-text("Close")'); // Adjust to the actual close button selector
    await closeModalButton.click();

    // Verify that the modal is no longer visible
    await expect(uploadModal).toBeHidden();
  });
});
