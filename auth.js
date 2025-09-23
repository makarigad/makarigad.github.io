// --- Security Best Practice ---
// It is strongly recommended to store your Firebase config in a secure
// way, for example, using environment variables on a server, rather than
// exposing them directly in client-side code.
const firebaseConfig = {
  apiKey: "AIzaSyA8UJViacRzajLMJ0lonhrbuuEGO54uOJ4",
  authDomain: "makari-c4270.firebaseapp.com",
  projectId: "makari-c4270",
  storageBucket: "makari-c4270.firebasestorage.app",
  messagingSenderId: "188970014713",
  appId: "1:188970014713:web:980629f953af694e81cf28"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// --- DOM Elements ---
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('login-button');
const errorMessage = document.getElementById('error-message');

// --- Event Listener ---
loginForm.addEventListener('submit', (e) => {
  // Prevent default form submission which reloads the page
  e.preventDefault();

  // 1. Get user input
  const email = emailInput.value;
  const password = passwordInput.value;

  // 2. Simple validation
  if (!email || !password) {
    showError("Please enter both email and password.");
    return;
  }
  
  // 3. Set loading state
  setLoading(true);

  // 4. Sign in with Firebase
  auth.signInWithEmailAndPassword(email, password)
    .then((userCredential) => {
      // Login successful
      console.log("Login successful!", userCredential.user);
      window.location.href = "data-entry.html"; // Redirect to secure page
    })
    .catch((error) => {
      // Handle different authentication errors
      let friendlyMessage = "An error occurred. Please try again.";
      switch (error.code) {
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          friendlyMessage = "Invalid email or password.";
          break;
        case 'auth/invalid-email':
          friendlyMessage = "Please enter a valid email address.";
          break;
      }
      showError(friendlyMessage);
    })
    .finally(() => {
      // 5. Reset loading state regardless of outcome
      setLoading(false);
    });
});


// --- Helper Functions ---

/**
 * Displays an error message to the user.
 * @param {string} message The message to display.
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

/**
 * Toggles the loading state of the login button.
 * @param {boolean} isLoading True to set loading state, false to reset.
 */
function setLoading(isLoading) {
  if (isLoading) {
    loginButton.disabled = true;
    loginButton.textContent = 'Signing In...';
  } else {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign In';
  }
}