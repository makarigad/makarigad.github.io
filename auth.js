import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9yreNlyZw9DFiuGlwMAecaDkdwn5cxDY",
  authDomain: "makari-gad.firebaseapp.com",
  projectId: "makari-gad",
  storageBucket: "makari-gad.appspot.com",
  messagingSenderId: "724611254155",
  appId: "1:724611254155:web:79851f67861cee3f90918e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("error-message");
const loginBtn = document.getElementById("login-button");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
  errorBox.style.display = "block";
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
  errorBox.style.display = "none";
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Signing In..." : "Sign In";
}

if(form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      clearError();
    
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
    
      if (!email || !password) {
        showError("Please enter both email and password.");
        return;
      }
    
      setLoading(true);
    
      signInWithEmailAndPassword(auth, email, password)
        .then(() => {
          window.location.href = "plant-data.html";
        })
        .catch((error) => {
          console.error(error);
          let msg = "Login failed. Please try again.";
    
          switch (error.code) {
            case "auth/user-not-found":
            case "auth/invalid-credential":
              msg = "Invalid email or password.";
              break;
            case "auth/wrong-password":
              msg = "Incorrect password.";
              break;
            case "auth/invalid-email":
              msg = "Invalid email address.";
              break;
            case "auth/too-many-requests":
              msg = "Too many attempts. Please try again later.";
              break;
          }
    
          showError(msg);
        })
        .finally(() => setLoading(false));
    });
}