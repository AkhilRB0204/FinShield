/**
 * Example messages for the screen page: two built to trip the message rules and
 * one ordinary email that should score low. Invented for the demo; every name,
 * address and number in them is made up.
 */
export const SCREEN_EXAMPLES = [
  {
    label: "Invoice with changed bank details",
    text: "From: \"Accounts Receivable\" <billing@northwind-supplies.com>\nReply-To: payments.northwind@gmail.com\nSubject: Invoice INV-20931: updated bank details\n\nHello,\n\nPlease find invoice INV-20931 for $18,450.00 below. We have changed our bank, so please update your records and send payment to our new bank details by end of day to avoid a late fee.\n\nBank: First Harbor Bank\nRouting number: 021000089\nAccount number: 4410029381\n\nThank you,\nDana Whitfield\nAccounts Receivable, Northwind Supplies",
  },
  {
    label: "Account-suspension notice",
    text: "From: \"PayPal Security\" <paypal.security.alerts@gmail.com>\nSubject: Final notice: your account has been limited\n\nDear customer,\n\nWe noticed unusual sign-in activity on your account. Your account has been limited and will be suspended within 24 hours unless you verify your identity.\n\nClick the link below to restore access:\n<a href=\"http://paypa1-account-verify.com/login\">https://www.paypal.com/myaccount</a>\n\nYou will be asked for your password and security code to confirm your identity.\n\nPayPal Security Team",
  },
  {
    label: "Ordinary work email",
    text: "From: \"Maya Chen\" <maya.chen@brightline-design.com>\nSubject: Notes from Thursday's design review\n\nHi Sam,\n\nThanks for walking us through the new onboarding screens. I've put my notes in the shared doc: https://docs.brightline-design.com/reviews/onboarding\n\nThe main open question is whether to keep the progress bar on the last step. No rush on this; let's pick it up at next week's sync.\n\nBest,\nMaya",
  },
];
