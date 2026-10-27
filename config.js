
/**
 * ============================================================
 * QA BUG TRACKER V2
 * Firebase Configuration
 * ============================================================
 *
 * GitHub Repository:
 * https://github.com/onkar948/QA-Dashboard
 *
 * Firebase Project:
 * qa-bug-tracker-b1d32
 *
 * Application Roles:
 * 1. Admin     - Password-protected
 * 2. Tester    - Password-protected
 * 3. Dashboard - Public, read-only
 *
 * IMPORTANT:
 * Passwords must NOT be stored in this file.
 * Firebase Authentication validates user credentials.
 *
 * Firestore Security Rules must enforce access permissions.
 * ============================================================
 */

'use strict';

const APP_CONFIG = {

  // ----------------------------------------------------------
  // FIREBASE PROJECT CONFIGURATION
  // ----------------------------------------------------------

  firebase: {

    apiKey: "AIzaSyDewz5leNUAHLAL0_6rS0H2EHv58uRV20U",

    authDomain: "qa-bug-tracker-b1d32.firebaseapp.com",

    projectId: "qa-bug-tracker-b1d32",

    storageBucket: "qa-bug-tracker-b1d32.firebasestorage.app",

    messagingSenderId: "877599639764",

    appId: "1:877599639764:web:385ff8dd00de26e43bd341",

    measurementId: "G-162QNWW0Z3"

  },

  // ----------------------------------------------------------
  // ROLE ACCOUNTS
  // ----------------------------------------------------------
  //
  // Create two accounts in:
  //
  // Firebase Console
  // Authentication > Users > Add user
  //
  // Replace the email addresses below with the accounts
  // you actually create.
  //
  // The passwords are configured in Firebase Authentication,
  // not in this JavaScript file.
  // ----------------------------------------------------------

  adminEmail: "qa-admin@infoteksoftware.com",

  testerEmail: "qa-tester@infoteksoftware.com"

};
