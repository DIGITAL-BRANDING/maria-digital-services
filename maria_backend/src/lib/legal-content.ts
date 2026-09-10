export interface LegalSection {
  title: string;
  body: string;
}

// Mirrors imam_datasub/lib/features/legal/presentation/screens/legal_document_screen.dart
// exactly. If you update the wording in one place, update it in the other — Play Store
// review and basic legal hygiene both expect the public page and in-app copy to match.
export const EFFECTIVE_DATE = '4 August 2026';

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: '1. Information we collect',
    body: 'MAJOR DATA-LINK collects account information such as name, phone number, email address, login details, device information, wallet activity, transaction records, beneficiaries, KYC details where required, support messages, and payment references needed to provide VTU, bill payment, wallet, referral, notification and support services.'
  },
  {
    title: '2. How we use information',
    body: 'We use your information to create and secure your account, process wallet funding, data, airtime, cable, electricity and other purchases, verify payments, prevent fraud, provide customer support, send transaction notifications, maintain records, improve the app, comply with legal obligations and protect users from unauthorized access.'
  },
  {
    title: '3. Payments and third parties',
    body: 'Wallet funding and some verification services may be processed through payment and service providers such as Paystack, Supabase, Firebase and VTU provider APIs including Alrahuz Data. We share only the information needed to complete the requested service, verify transactions, create virtual accounts, send notifications or maintain platform security.'
  },
  {
    title: '4. KYC and security',
    body: 'Where KYC is required, we may collect BVN/NIN-related verification details, bank details and identity information. Sensitive data is used only for verification, compliance, wallet protection and fraud prevention. We apply access controls, encrypted storage where available and secure transport for API communication.'
  },
  {
    title: '5. Data retention',
    body: 'We retain account and transaction records for as long as needed to provide services, resolve complaints, meet accounting obligations, investigate fraud, comply with law and maintain audit trails. If you request account deletion, we disable account access and anonymize personal identifiers where lawful while retaining financial records that must be preserved.'
  },
  {
    title: '6. Your choices',
    body: 'You may update your profile, change your password or transaction PIN, enable or disable biometric login on your device, contact support about inaccurate data, and request account deactivation or deletion from the app. Some transaction records cannot be removed where retention is legally or operationally required.'
  },
  {
    title: '7. Contact',
    body: 'For privacy requests, complaints or support, contact MAJOR DATA-LINK through the support email or WhatsApp numbers shown below.'
  }
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: '1. Acceptance of terms',
    body: 'By creating an account or using MAJOR DATA-LINK, you agree to these Terms & Conditions. If you do not agree, do not use the application or services.'
  },
  {
    title: '2. Services',
    body: 'MAJOR DATA-LINK provides wallet-based VTU and bill payment services, including data, airtime, cable TV, electricity, result checker, recharge/data cards, referrals and related services. Availability, pricing, validity and provider response depend on third-party networks and service providers.'
  },
  {
    title: '3. Wallet funding and payments',
    body: 'You are responsible for transferring funds to the correct account details displayed in your app and for confirming transaction details before payment. Wallet credit may be automatic or subject to payment provider confirmation. Charges, caps and processing delays may apply. Incorrect transfers, duplicate payments or failed third-party confirmations may require manual review.'
  },
  {
    title: '4. Wallet balance and referral earnings',
    body: 'Wallet balance may only be used to purchase services within MAJOR DATA-LINK, such as data, airtime, cable TV, electricity, result checker and recharge/data cards. Wallet balance cannot be transferred to another user\u2019s account and cannot be withdrawn or cashed out to a bank account, card or any external destination. Referral commission accrues separately as you refer other users; once released, referral commission can only be moved into your own wallet balance for use within the app \u2014 it is not paid out as cash and cannot be withdrawn to a bank account.'
  },
  {
    title: '5. Purchases and refunds',
    body: 'Before buying data, airtime or bills, confirm the network, phone number, package, amount and validity. Successful provider transactions are usually final. If a provider transaction fails after wallet debit, MAJOR DATA-LINK will attempt to reverse or refund the wallet balance based on confirmed provider status.'
  },
  {
    title: '6. Account security',
    body: 'You must keep your password, OTP, device access and transaction PIN confidential. Biometric login only protects access on your device. MAJOR DATA-LINK is not responsible for losses caused by sharing login details, PINs, OTPs, or allowing unauthorized device access.'
  },
  {
    title: '7. Prohibited use',
    body: 'You must not use MAJOR DATA-LINK for fraud, unauthorized transactions, abuse of referral systems, attempts to transfer or cash out wallet balance or referral earnings outside the app, chargeback abuse, illegal activity, attempted hacking, API abuse, or any action that harms the platform, providers or other users.'
  },
  {
    title: '8. Limitation of liability',
    body: 'Services rely on telecom networks, payment processors, banks and VTU providers. MAJOR DATA-LINK will make reasonable efforts to process and resolve transactions, but we are not liable for delays, outages, reversals, provider downtime, user-entered wrong details or events outside our control.'
  },
  {
    title: '9. Changes and contact',
    body: 'We may update these terms as the service grows. Continued use after updates means you accept the revised terms. For complaints or support, contact MAJOR DATA-LINK through the official support channels below.'
  }
];

