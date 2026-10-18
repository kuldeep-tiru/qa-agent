import { TestCaseSchema } from '../../src/domain/test-case.js';

/** Hand-written SauceDemo cases used by the writer tests and the sample script. */
export const sampleTestCases = TestCaseSchema.array().parse([
  {
    id: 'TC_Auth_ValidLogin_001',
    requirementRef: 'BR 1.1',
    scenario: 'Login',
    title: 'Verify login with a valid username and password',
    preconditions: ['User is on the SauceDemo login page'],
    steps: [
      { description: 'Open the login page', testData: 'https://www.saucedemo.com', expected: 'Login form is displayed' },
      { description: 'Enter the username', testData: 'standard_user' },
      { description: 'Enter the password', testData: 'secret_sauce' },
      { description: 'Click Login', expected: 'User lands on the products page showing the inventory list' },
    ],
    priority: 'High',
    testType: 'Functional',
  },
  {
    id: 'TC_Auth_LockedOutUser_001',
    requirementRef: 'BR 1.1',
    scenario: 'Login',
    title: 'Verify login is blocked for a locked out user',
    preconditions: ['User is on the SauceDemo login page'],
    steps: [
      { description: 'Enter the locked out username and the password', testData: 'locked_out_user / secret_sauce' },
      { description: 'Click Login', expected: 'An error message states that the user has been locked out' },
    ],
    priority: 'High',
    testType: 'Negative',
  },
  {
    id: 'TC_Checkout_CompleteOrder_001',
    requirementRef: 'BR 4.2',
    scenario: 'Complete a purchase',
    title: 'Verify a user can complete an order end to end',
    preconditions: ['User is logged in as standard_user', 'At least one product is in the cart'],
    steps: [
      { description: 'Open the cart and click Checkout' },
      { description: 'Enter first name, last name and postal code', testData: 'Test / User / 12345' },
      { description: 'Click Continue', expected: 'Order summary lists the products with item total, tax and total' },
      { description: 'Click Finish' },
      { description: 'Check the confirmation page', expected: 'A message thanks the user for the order' },
      { description: 'Open the cart', expected: 'The cart is empty' },
    ],
    priority: 'High',
    testType: 'End-to-End',
  },
]);
