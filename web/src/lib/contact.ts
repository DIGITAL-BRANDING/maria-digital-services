// Mirrors major_data_link/lib/core/config/app_config.dart and
// major_data_link_backend/src/routes/legal.routes.ts. If contact details
// change, update all three.
export const CONTACT = {
  whatsapp: '+2348037289774',
  phoneAlt: '07025859543',
  whatsappChannelUrl: 'https://chat.whatsapp.com/BzqJHqki8vE7TnfpVIz5WZ?s=cl&p=a&ilr=0',
  whatsappGroupUrl: 'https://chat.whatsapp.com/BzqJHqki8vE7TnfpVIz5WZ?s=cl&p=a&ilr=0',
  email: 'kindnesscomp20@gmail.com',
  emailDisplay: 'kindnesscomp20@gmail.com / sunusiusama94@gmail.com',
};

export function whatsappLink(_text: string) {
  return CONTACT.whatsappGroupUrl;
}

// GitHub's "latest release" download URL is stable forever — it always
// resolves to whatever release is currently marked "Latest" on
// https://github.com/DIGITAL-BRANDING/MAJOR-DATA-LINK/releases, as long as
// that release has an asset with EXACTLY this filename attached. So:
// every time you publish a new APK, name the uploaded file
// "MajorDataLink.apk" (case-sensitive) and this link never needs to change.
// See the release checklist in web/README.md before the first upload.
export const ANDROID_APK_URL =
  'https://github.com/DIGITAL-BRANDING/MAJOR-DATA-LINK/releases/latest/download/MajorDataLink.apk';
