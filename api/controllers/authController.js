const jwt = require('jsonwebtoken');
const { auth, firestore } = require('../config/firebase');

const authController = {
  // Register endpoint - creates new athlete users
  register: async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      // Validate required fields
      if (!email || !password || !firstName || !lastName) {
        return res.status(400).json({
          success: false,
          message: 'All fields are required (email, password, firstName, lastName)'
        });
      }

      // Create user in Firebase Auth
      const userRecord = await auth.createUser({
        email: email,
        password: password,
        displayName: `${firstName} ${lastName}`
      });

      // Save user details in Firestore with athlete type
      const userData = {
        uid: userRecord.uid,
        email: email,
        firstName: firstName,
        lastName: lastName,
        userType: 'athlete', // All new registrations are athletes
        createdAt: new Date().toISOString(),
        isActive: true
      };

      await firestore.collection('users').doc(userRecord.uid).set(userData);

      res.status(201).json({
        success: true,
        message: 'Athlete registered successfully',
        user: {
          uid: userRecord.uid,
          email: email,
          firstName: firstName,
          lastName: lastName,
          userType: 'athlete'
        }
      });

    } catch (error) {
      console.error('Registration error:', error);
      
      // Handle Firebase Auth errors
      if (error.code === 'auth/email-already-exists') {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
      
      if (error.code === 'auth/invalid-email') {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Registration failed',
        error: error.message
      });
    }
  },

  // Login endpoint - handles both athletes and trainers
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      // Get user by email from Firebase Auth
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      // Get user details from Firestore
      const userDoc = await firestore.collection('users').doc(userRecord.uid).get();
      
      if (!userDoc.exists) {
        return res.status(401).json({
          success: false,
          message: 'User not found in database'
        });
      }

      const userData = userDoc.data();

      // Check if user is active
      if (!userData.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      // Create JWT token with user info
      const jwtPayload = {
        uid: userRecord.uid,
        email: userData.email,
        userType: userData.userType
      };

      const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

     
      res.status(200).json({
        success: true,
        message: 'Login successful',
        token: jwtToken,
        user: {
          uid: userRecord.uid,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          userType: userData.userType
        },
        redirectUrl: userData.userType
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: error.message
      });
    }
  },

  // Get current user info (protected route)
  getProfile: async (req, res) => {
    try {
      const userDoc = await firestore.collection('users').doc(req.user.uid).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const userData = userDoc.data();
      
      res.status(200).json({
        success: true,
        user: {
          uid: userData.uid,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          userType: userData.userType,
          createdAt: userData.createdAt
        }
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile',
        error: error.message
      });
    }
  }
};

module.exports = authController;
