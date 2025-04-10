import axios from 'axios';
import * as localHistoryService from './localHistoryService';

// Use local API when in development mode, Railway API in production
const API_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:8000' 
  : 'https://web-production-62f88.up.railway.app';
console.log('Using API URL:', API_URL);

// Create axios instance with base URL
const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add response interceptor to handle standardized error format
api.interceptors.response.use(
  response => response, // Return successful responses as-is
  error => {
    // Check if the error is due to an expired token (401 Unauthorized)
    if (error.response && error.response.status === 401) {
      console.log('Received 401 unauthorized, token may be expired');
      
      // Store the original request to retry later
      const originalRequest = error.config;
      
      // Only attempt to refresh token if not already doing so and not in a refresh loop
      if (!originalRequest._retry && !originalRequest.url.includes('/auth/refresh')) {
        originalRequest._retry = true;
        
        console.log('Attempting to refresh token and retry request');
        
        // Return a promise that will resolve when the token is refreshed and request retried
        return refreshAuthToken()
          .then(response => {
            // Token refreshed successfully
            const { access_token } = response;
            
            // Update the auth header with the new token
            originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
            
            // Set the new token for future requests
            setAuthToken(access_token);
            
            // Retry the original request
            return axios(originalRequest);
          })
          .catch(refreshError => {
            console.error('Token refresh failed, cannot retry request:', refreshError);
            
            // Clear auth data on refresh failure
            clearAuthToken();
            localStorage.removeItem('auth');
            
            // Redirect to login page if in browser environment
            if (typeof window !== 'undefined') {
              window.location.href = '/login?session_expired=true';
            }
            
            return Promise.reject(error);
          });
      }
    }
    
    // Format error consistently based on our new API error format
    if (error.response && error.response.data) {
      // Extract the error details from the standardized format
      const errorData = error.response.data;
      let errorMessage = "An unexpected error occurred";
      
      // Check if the error follows our new format with the error object
      if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
        
        // Attach additional error details if available
        if (errorData.error.details) {
          error.details = errorData.error.details;
        }
        
        if (errorData.error.type) {
          error.type = errorData.error.type;
        }
        
        if (errorData.error.error_id) {
          error.errorId = errorData.error.error_id;
          errorMessage += ` (Error ID: ${error.errorId})`;
        }
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      }
      
      // Create a new error with the formatted message
      const formattedError = new Error(errorMessage);
      formattedError.response = error.response;
      formattedError.status = error.response.status;
      formattedError.details = error.details;
      formattedError.type = error.type;
      formattedError.errorId = error.errorId;
      
      return Promise.reject(formattedError);
    }
    
    // If error doesn't match our format, return it as-is
    return Promise.reject(error);
  }
);

// Auth token handling
let authToken = null;
let isRefreshingToken = false;
let refreshSubscribers = [];

// Function to subscribe to token refresh
const subscribeTokenRefresh = (callback) => {
  refreshSubscribers.push(callback);
};

// Function to notify subscribers that token is refreshed
const onTokenRefreshed = (token) => {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
};

// Set auth token for API requests
export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

// Clear auth token
export const clearAuthToken = () => {
  authToken = null;
  delete api.defaults.headers.common['Authorization'];
};

// Check if token exists in storage and set it
export const initAuthFromStorage = () => {
  try {
    const authData = localStorage.getItem('auth');
    if (authData) {
      const { accessToken } = JSON.parse(authData);
      if (accessToken) {
        setAuthToken(accessToken);
        return true;
      }
    }
  } catch (error) {
    console.error('Error initializing auth token:', error);
    
    // Clear any invalid token data
    localStorage.removeItem('auth');
  }
  return false;
};

// Enhanced function to check auth status
export const checkAuthStatus = async () => {
  try {
    if (!authToken) {
      return { isAuthenticated: false };
    }
    
    // Make a lightweight request to validate the token
    const response = await api.get('/auth/status');
    return { isAuthenticated: true, user: response.data };
  } catch (error) {
    console.error('Auth status check failed:', error);
    
    // If unauthorized, try to refresh the token once
    if (error.response && error.response.status === 401) {
      try {
        // Attempt to refresh the token
        const refreshResponse = await refreshAuthToken();
        if (refreshResponse && refreshResponse.access_token) {
          // Token refreshed successfully, try status check again
          const newResponse = await api.get('/auth/status');
          return { isAuthenticated: true, user: newResponse.data };
        }
      } catch (refreshError) {
        console.error('Token refresh during status check failed:', refreshError);
        // Clear auth data on refresh failure
        clearAuthToken();
        localStorage.removeItem('auth');
      }
    }
    
    return { isAuthenticated: false, error };
  }
};

// Initialize auth token from storage on import
initAuthFromStorage();

// Get progress updates for a learning path using SSE (Server-Sent Events)
export const getProgressUpdates = (taskId, onMessage, onError, onComplete) => {
  // Create the correct URL using the same API_URL base
  const url = new URL(`/api/progress/${taskId}`, API_URL);
  let retryCount = 0;
  const MAX_RETRIES = 3;
  let eventSource = null;
  
  // Function to create and connect the EventSource
  const connect = () => {
    try {
      console.log(`Connecting to SSE progress updates for task ${taskId}`);
      eventSource = new EventSource(url.toString());
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.complete) {
            console.log(`SSE connection completed for task ${taskId}`);
            eventSource.close();
            if (onComplete) onComplete();
            return;
          }
          
          // Check for error message format
          if (data.message && data.message.startsWith("Error:")) {
            // This is an error message from the server
            if (onError) {
              onError(new Error(data.message.replace("Error: ", "")));
            }
            return;
          }
          
          // Reset retry count on successful messages
          retryCount = 0;
          
          if (onMessage) onMessage(data);
        } catch (err) {
          console.error('Error parsing SSE message:', err);
          if (onError) onError(err);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('SSE Error:', error);
        
        // Close the current connection
        eventSource.close();
        
        // Try to reconnect if we haven't exceeded max retries
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          console.log(`Retrying SSE connection (attempt ${retryCount}/${MAX_RETRIES})...`);
          // Wait 1 second before reconnecting
          setTimeout(connect, 1000);
        } else {
          console.error(`Failed to connect to SSE after ${MAX_RETRIES} attempts`);
          if (onError) onError(new Error('Connection to progress updates was lost. Please check your network connection.'));
        }
      };
      
      // Add onopen handler to track successful connections
      eventSource.onopen = () => {
        console.log(`SSE connection opened successfully for task ${taskId}`);
        // Reset retry count on successful connection
        retryCount = 0;
      };
    } catch (initError) {
      console.error('Error initializing SSE connection:', initError);
      if (onError) onError(new Error('Failed to connect to progress updates. Please try refreshing the page.'));
    }
  };
  
  // Start the connection
  connect();
  
  return {
    close: () => {
      if (eventSource) {
        console.log(`Manually closing SSE connection for task ${taskId}`);
        eventSource.close();
      }
    },
  };
};

// Delete a learning path task
export const deleteLearningPath = async (taskId) => {
  try {
    const response = await api.delete(`/learning-path/${taskId}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting learning path:', error);
    throw new Error(error.message || 'Failed to delete learning path. Please try again.');
  }
};

// Session storage keys for API keys
const GOOGLE_KEY_TOKEN_STORAGE = 'learning_path_google_key_token';
const PPLX_KEY_TOKEN_STORAGE = 'learning_path_pplx_key_token';
const REMEMBER_TOKENS_STORAGE = 'learning_path_remember_tokens';

// API token management functions
export const saveApiTokens = (googleKeyToken, pplxKeyToken, remember = false) => {
  // Only save if remember is true
  if (remember) {
    try {
      // Use sessionStorage for temporary storage during the browser session
      sessionStorage.setItem(GOOGLE_KEY_TOKEN_STORAGE, googleKeyToken || '');
      sessionStorage.setItem(PPLX_KEY_TOKEN_STORAGE, pplxKeyToken || '');
      sessionStorage.setItem(REMEMBER_TOKENS_STORAGE, 'true');
    } catch (error) {
      console.error('Error saving API tokens to session storage:', error);
    }
  } else {
    clearSavedApiTokens();
  }
  
  return { googleKeyToken, pplxKeyToken, remember };
};

export const getSavedApiTokens = () => {
  try {
    const remember = sessionStorage.getItem(REMEMBER_TOKENS_STORAGE) === 'true';
    if (remember) {
      return {
        googleKeyToken: sessionStorage.getItem(GOOGLE_KEY_TOKEN_STORAGE) || null,
        pplxKeyToken: sessionStorage.getItem(PPLX_KEY_TOKEN_STORAGE) || null,
        remember,
      };
    }
  } catch (error) {
    console.error('Error retrieving API tokens from session storage:', error);
  }
  
  return { googleKeyToken: null, pplxKeyToken: null, remember: false };
};

export const clearSavedApiTokens = () => {
  try {
    sessionStorage.removeItem(GOOGLE_KEY_TOKEN_STORAGE);
    sessionStorage.removeItem(PPLX_KEY_TOKEN_STORAGE);
    sessionStorage.removeItem(REMEMBER_TOKENS_STORAGE);
  } catch (error) {
    console.error('Error clearing API tokens from session storage:', error);
  }
};

// Authentication API functions
export const register = async (email, password, fullName) => {
  try {
    const response = await api.post('/auth/register', {
      email,
      password,
      full_name: fullName
    });
    return response.data;
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

export const login = async (email, password, rememberMe = false) => {
  try {
    const response = await api.post('/auth/login', {
      email,
      password,
      remember_me: rememberMe
    });
    return response.data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

// Enhanced refresh auth token function with concurrency control
export const refreshAuthToken = async () => {
  // If already refreshing token, wait for that to complete instead of making multiple calls
  if (isRefreshingToken) {
    return new Promise((resolve, reject) => {
      subscribeTokenRefresh(token => {
        if (token) {
          resolve({ access_token: token });
        } else {
          reject(new Error('Token refresh failed'));
        }
      });
    });
  }
  
  try {
    isRefreshingToken = true;
    const response = await api.post('/auth/refresh');
    
    // Update token in API instance and localStorage
    const { access_token } = response.data;
    setAuthToken(access_token);
    
    // Update auth data in localStorage if it exists
    const authData = localStorage.getItem('auth');
    if (authData) {
      const parsedAuth = JSON.parse(authData);
      parsedAuth.accessToken = access_token;
      parsedAuth.expiresIn = response.data.expires_in;
      parsedAuth.tokenExpiry = Math.floor(Date.now() / 1000) + response.data.expires_in;
      
      // Update user data if provided
      if (response.data.user) {
        parsedAuth.user = response.data.user;
      }
      
      localStorage.setItem('auth', JSON.stringify(parsedAuth));
    }
    
    // Notify subscribers that token has been refreshed
    onTokenRefreshed(access_token);
    
    return response.data;
  } catch (error) {
    console.error('Token refresh error:', error);
    
    // Notify subscribers of failure
    onTokenRefreshed(null);
    
    throw error;
  } finally {
    isRefreshingToken = false;
  }
};

export const logout = async () => {
  try {
    await api.post('/auth/logout');
    return true;
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

// Learn path migration function
export const migrateLearningPaths = async (learningPaths) => {
  try {
    // If learning paths weren't provided directly, get them from local storage
    if (!learningPaths || !Array.isArray(learningPaths)) {
      const localHistory = localHistoryService.getLocalHistory();
      learningPaths = localHistory.entries || [];
    }
    
    // Process the learning paths to ensure they're in the right format for migration
    const processedPaths = learningPaths.map(path => {
      // Create a new object to avoid modifying the original
      const processedPath = { ...path };
      
      // Ensure path_id exists (use UUID format which is what the backend expects)
      if (!processedPath.path_id) {
        // If an id exists, use it as path_id (but ensure it's UUID-like)
        if (processedPath.id) {
          // If id already looks like a UUID (contains hyphens), use it directly
          if (String(processedPath.id).includes('-')) {
            processedPath.path_id = String(processedPath.id);
          } else {
            // Otherwise, generate a UUID-like ID that incorporates the original id
            const timestamp = Date.now();
            const randomPart = Math.random().toString(36).substring(2, 10);
            processedPath.path_id = `${timestamp}-${randomPart}-${String(processedPath.id)}`;
          }
        } else {
          // No id at all, generate a completely new UUID-like string
          const timestamp = Date.now();
          const randomPart1 = Math.random().toString(36).substring(2, 10);
          const randomPart2 = Math.random().toString(36).substring(2, 10);
          processedPath.path_id = `${timestamp}-${randomPart1}-${randomPart2}`;
        }
      }
      
      // Make sure topic exists
      if (!processedPath.topic && processedPath.path_data && processedPath.path_data.topic) {
        processedPath.topic = processedPath.path_data.topic;
      } else if (!processedPath.topic) {
        processedPath.topic = "Untitled Path";
      }
      
      // Make sure path_data exists
      if (!processedPath.path_data) {
        // If it's not there, use the entry itself as path_data
        // This handles the case where the entire entry is actually the path data
        processedPath.path_data = { ...path };
      }
      
      // Make sure tags array exists
      if (!processedPath.tags || !Array.isArray(processedPath.tags)) {
        processedPath.tags = [];
      }
      
      // Make sure source is set
      if (!processedPath.source) {
        processedPath.source = 'imported';
      }
      
      return processedPath;
    });
    
    console.log("Migrating learning paths:", processedPaths);
    
    const response = await api.post('/learning-paths/migrate', {
      learning_paths: processedPaths
    });
    
    return response.data;
  } catch (error) {
    console.error('Learning path migration error:', error);
    throw error;
  }
};

// Get tokens for API keys (either authenticate and get new tokens or use stored ones)
export const authenticateApiKeys = async (googleKey, pplxKey, remember = false) => {
  try {
    // Call the new authentication endpoint to get tokens
    const response = await api.post('/auth/api-keys', {
      google_api_key: googleKey,
      pplx_api_key: pplxKey,
    });
    
    const { 
      google_key_token, 
      pplx_key_token, 
      google_key_valid, 
      pplx_key_valid,
      google_key_error,
      pplx_key_error
    } = response.data;
    
    // Save tokens if remember option is checked
    if (remember && (google_key_token || pplx_key_token)) {
      saveApiTokens(google_key_token, pplx_key_token, true);
    }
    
    return {
      googleKeyToken: google_key_token,
      pplxKeyToken: pplx_key_token,
      googleKeyValid: google_key_valid,
      pplxKeyValid: pplx_key_valid,
      googleKeyError: google_key_error,
      pplxKeyError: pplx_key_error
    };
  } catch (error) {
    console.error('Error authenticating API keys:', error);
    // Use the error message from our interceptor
    throw new Error(error.message || 'Failed to authenticate API keys. Please try again.');
  }
};

// Validate API keys
export const validateApiKeys = async (googleKey, pplxKey) => {
  try {
    const response = await api.post('/validate-api-keys', {
      google_api_key: googleKey,
      pplx_api_key: pplxKey,
    });
    return response.data;
  } catch (error) {
    console.error('Error validating API keys:', error);
    // Use the error message from our interceptor
    throw new Error(error.message || 'Failed to validate API keys. Please try again.');
  }
};

// Generate learning path with tokens
export const generateLearningPath = async (topic, options = {}) => {
  const { 
    parallelCount = 2, 
    searchParallelCount = 3, 
    submoduleParallelCount = 2,
    desiredModuleCount = null,
    desiredSubmoduleCount = null,
    googleKeyToken = null,
    pplxKeyToken = null,
    rememberTokens = false,
    language = 'en'  // Language parameter with English as default
  } = options;
  
  try {
    console.log("Generating learning path with server-provided API keys");
    
    // Prepare request data
    const requestData = {
      topic,
      parallel_count: parallelCount,
      search_parallel_count: searchParallelCount,
      submodule_parallel_count: submoduleParallelCount,
      language // Include the language parameter
    };
    
    // Add desired module count if specified
    if (desiredModuleCount !== null) {
      requestData.desired_module_count = desiredModuleCount;
    }
    
    // Add desired submodule count if specified
    if (desiredSubmoduleCount !== null) {
      requestData.desired_submodule_count = desiredSubmoduleCount;
    }
    
    // For backward compatibility, include API key tokens if available
    if (googleKeyToken) requestData.google_key_token = googleKeyToken;
    if (pplxKeyToken) requestData.pplx_key_token = pplxKeyToken;
    
    const response = await api.post('/generate-learning-path', requestData);
    return response.data;
  } catch (error) {
    console.error('Error generating learning path:', error);
    throw new Error(error.message || 'Failed to start learning path generation. Please try again.');
  }
};

// Get learning path by task ID
export const getLearningPath = async (taskId) => {
  try {
    const response = await api.get(`/learning-path/${taskId}`);
    
    // Check for error field in completed tasks
    if (response.data.status === 'failed' && response.data.error) {
      const error = new Error(
        response.data.error.message || 
        'The learning path generation failed. Please try again.'
      );
      
      // Add additional details if available
      if (response.data.error.details) {
        error.details = response.data.error.details;
      }
      
      if (response.data.error.type) {
        error.type = response.data.error.type;
      }
      
      throw error;
    }
    
    // Handle different API response formats - some endpoints use 'result', others use 'learning_path'
    if (response.data.status === 'completed') {
      // Normalize the response to always have 'result' field
      if (response.data.learning_path && !response.data.result) {
        response.data.result = response.data.learning_path;
      }
    }
    
    return response.data;
  } catch (error) {
    console.error('Error fetching learning path:', error);
    throw error;
  }
};

// History API functions (now using server-side API)
export const getHistoryPreview = async (sortBy = 'creation_date', filterSource = null, searchTerm = null) => {
  // Create a cache key based on filter parameters
  const cacheKey = `history_preview_${sortBy}_${filterSource || 'null'}_${searchTerm || 'null'}`;
  const cacheTimeMs = 60000; // 1 minute cache
  
  try {
    // If no auth token is present, fall back to local storage
    if (!authToken) {
      console.log('No auth token present, using local storage for history');
      return localHistoryService.getHistoryPreview(sortBy, filterSource, searchTerm);
    }
    
    // Check browser cache first for faster repeat loads
    const cachedData = sessionStorage.getItem(cacheKey);
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData);
      const age = Date.now() - timestamp;
      
      // Use cached data if it's fresh enough (less than cacheTimeMs old)
      if (age < cacheTimeMs) {
        console.log(`Using cached history data (${Math.round(age / 1000)}s old)`);
        return data;
      } else {
        console.log('Cached history data expired, fetching fresh data');
      }
    }
    
    // Prepare request with optimized parameters
    const params = new URLSearchParams();
    params.append('sort_by', sortBy);
    params.append('include_full_data', 'false'); // Use lightweight endpoint
    if (filterSource) params.append('source', filterSource);
    if (searchTerm) params.append('search', searchTerm);
    
    console.time('History API Request');
    const response = await api.get(`/learning-paths?${params.toString()}`);
    console.timeEnd('History API Request');
    
    if (response.data?.request_time_ms) {
      console.log(`Server processing time: ${response.data.request_time_ms}ms`);
    }
    
    // Ensure response.data has valid entries property
    if (!response.data || !response.data.entries) {
      console.warn('API response missing entries property, using empty array');
      return { entries: [], total: 0 };
    }
    
    // Cache the successful response
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({
        data: response.data,
        timestamp: Date.now()
      }));
    } catch (cacheError) {
      console.warn('Failed to cache history data:', cacheError);
      // Non-critical error, continue without caching
    }
    
    return response.data;
  } catch (serverError) {
    console.error('Server error fetching history:', serverError);
    
    // If we get a 401/403 error, clear the invalid auth token
    if (serverError.response && (serverError.response.status === 401 || serverError.response.status === 403)) {
      console.warn('Authentication error (401/403), clearing token and falling back to local storage');
      clearAuthToken();
    }
    
    // Fall back to local storage
    return localHistoryService.getHistoryPreview(sortBy, filterSource, searchTerm);
  }
};

export const getHistoryEntry = async (entryId) => {
  try {
    // If authenticated, use the server API
    if (authToken) {
      try {
        // Log the ID being used
        console.log('Fetching learning path with ID:', entryId);
        
        // Make the API call with the provided ID (should be path_id)
        const response = await api.get(`/learning-paths/${entryId}`);
        return { entry: response.data };
      } catch (serverError) {
        console.error('Server error fetching history entry:', serverError);
        
        // If we get a 401/403 error, clear the invalid auth token
        if (serverError.response && (serverError.response.status === 401 || serverError.response.status === 403)) {
          console.warn('Authentication error (401/403), clearing token and falling back to local storage');
          clearAuthToken();
        }
        
        // For backward compatibility, try local storage as fallback
        console.warn('Falling back to local storage for compatibility');
        const localEntry = localHistoryService.getHistoryEntry(entryId);
        if (localEntry && localEntry.entry) {
          console.log('Found entry in local storage with ID:', entryId);
          return localEntry;
        }
        
        // If both fail, throw a more helpful error
        throw new Error('Learning path not found. The ID may be invalid or the item has been deleted.');
      }
    } else {
      // Not authenticated, use local storage
      return localHistoryService.getHistoryEntry(entryId);
    }
  } catch (error) {
    console.error('Error fetching history entry:', error);
    throw error;
  }
};

export const saveToHistory = async (learningPath, source = 'generated') => {
  try {
    // If authenticated, save to server
    if (authToken) {
      console.log('Saving learning path to server database:', learningPath.topic);
      
      const response = await api.post('/learning-paths', {
        topic: learningPath.topic || 'Untitled',
        path_data: learningPath,
        favorite: false,
        tags: [],
        source: source
      });
      
      // The server returns the path_id which we should use for all future operations
      console.log('Learning path saved with path_id:', response.data.path_id);
      
      return { 
        success: true, 
        entry_id: response.data.path_id 
      };
    } else {
      // Otherwise save to local storage
      console.log('User not authenticated, saving to local storage');
      return localHistoryService.saveToHistory(learningPath, source);
    }
  } catch (error) {
    console.error('Error saving to history:', error);
    
    // Fall back to local storage if server fails or user is not authenticated
    console.warn('Falling back to local storage due to error');
    return localHistoryService.saveToHistory(learningPath, source);
  }
};

export const updateHistoryEntry = async (entryId, data) => {
  try {
    // If authenticated, use the API
    if (authToken) {
      // Log the ID being used
      console.log('Updating learning path with ID:', entryId);
      
      // Make the API call with the provided ID (should be path_id)
      await api.put(`/learning-paths/${entryId}`, data);
      return { success: true };
    } else {
      // Otherwise use local storage
      return localHistoryService.updateHistoryEntry(entryId, data);
    }
  } catch (error) {
    console.error('Error updating history entry:', error);
    
    // Try local storage as fallback only for unauthenticated users
    if (!authToken) {
      return localHistoryService.updateHistoryEntry(entryId, data);
    }
    
    throw error;
  }
};

export const deleteHistoryEntry = async (entryId) => {
  try {
    // If authenticated, use the API
    if (authToken) {
      // Log the ID being used
      console.log('Deleting learning path with ID:', entryId);
      
      // Make the API call with the provided ID (should be path_id)
      await api.delete(`/learning-paths/${entryId}`);
      return { success: true };
    } else {
      // Otherwise use local storage
      return localHistoryService.deleteHistoryEntry(entryId);
    }
  } catch (error) {
    console.error('Error deleting history entry:', error);
    
    // Try local storage as fallback only for unauthenticated users
    if (!authToken) {
      return localHistoryService.deleteHistoryEntry(entryId);
    }
    
    throw error;
  }
};

export const importLearningPath = async (jsonData) => {
  try {
    // Parse the JSON data
    const learningPath = JSON.parse(jsonData);
    
    // If authenticated, use the API
    if (authToken) {
      console.log('Importing learning path to server database:', learningPath.topic);
      
      const response = await api.post('/learning-paths', {
        topic: learningPath.topic || 'Untitled',
        path_data: learningPath,
        favorite: false,
        tags: [],
        source: 'imported'
      });
      
      console.log('Learning path imported with path_id:', response.data.path_id);
      
      return {
        success: true,
        entry_id: response.data.path_id,
        topic: learningPath.topic
      };
    } else {
      // Otherwise use local storage
      console.log('User not authenticated, importing to local storage');
      return localHistoryService.importLearningPath(jsonData);
    }
  } catch (error) {
    console.error('Error importing learning path:', error);
    
    // Fall back to local storage if server fails or user is not authenticated
    console.warn('Falling back to local storage due to error');
    return localHistoryService.importLearningPath(jsonData);
  }
};

export const clearHistory = async () => {
  try {
    // We don't have a bulk delete API, so we'll just clear local storage
    return localHistoryService.clearHistory();
  } catch (error) {
    console.error('Error clearing history:', error);
    throw error;
  }
};

export const exportHistory = async () => {
  try {
    // If authenticated, get all learning paths from API
    if (authToken) {
      const response = await api.get('/learning-paths?per_page=1000');
      
      // Ensure we have the path_id for each entry in the exported data
      const entries = response.data.entries.map(entry => ({
        ...entry,
        // Explicitly include path_id in case frontend code expects it at this property
        id: entry.path_id 
      }));
      
      return {
        entries: entries,
        last_updated: new Date().toISOString()
      };
    } else {
      // Otherwise get from local storage
      return localHistoryService.getLocalHistory();
    }
  } catch (error) {
    console.error('Error exporting history:', error);
    
    // Fall back to local storage if server fails
    return localHistoryService.getLocalHistory();
  }
};

// Get raw local history (used for migration)
export const getLocalHistoryRaw = () => {
  return localHistoryService.getLocalHistory();
};

// Clear local history
export const clearLocalHistory = () => {
  return localHistoryService.clearHistory();
};

/**
 * Downloads a learning path as PDF
 * @param {string} pathId - ID of the learning path to download
 * @returns {Promise<Blob>} - PDF data as a Blob
 */
export const downloadLearningPathPDF = async (pathId) => {
  try {
    // Make the request with responseType blob to handle binary data
    const response = await api.get(
      `/learning-paths/${pathId}/pdf`, 
      { 
        responseType: 'blob',
        headers: {
          'Accept': 'application/pdf'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Error downloading PDF:', error);
    throw new Error(error.message || 'Failed to download PDF');
  }
};

// Get user credits
export const getUserCredits = async () => {
  try {
    if (!authToken) {
      return { credits: 0 };
    }
    
    const response = await api.get('/auth/credits');
    return response.data;
  } catch (error) {
    console.error('Error fetching user credits:', error);
    
    // If unauthorized, clear the invalid token
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      console.warn('Token validation failed during credits fetch, clearing auth data');
      clearAuthToken();
      localStorage.removeItem('auth');
    }
    
    return { credits: 0 };
  }
};

// Admin API functions

// Get users with pagination and filtering
export const getUsers = async (page = 1, perPage = 10, search = '', isAdmin = null, isActive = null, hasCredits = null) => {
  try {
    const params = { page, per_page: perPage };
    
    if (search) params.search = search;
    if (isAdmin !== null) params.is_admin = isAdmin;
    if (isActive !== null) params.is_active = isActive;
    if (hasCredits !== null) params.has_credits = hasCredits;
    
    const response = await api.get('/admin/users', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
};

// Get a specific user by ID
export const getUser = async (userId) => {
  try {
    const response = await api.get(`/admin/users/${userId}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching user ${userId}:`, error);
    throw error;
  }
};

// Update a user's details
export const updateUser = async (userId, userData) => {
  try {
    const response = await api.patch(`/admin/users/${userId}`, userData);
    return response.data;
  } catch (error) {
    console.error(`Error updating user ${userId}:`, error);
    throw error;
  }
};

// Add credits to a user
export const addCredits = async (userId, amount, notes = '') => {
  try {
    const response = await api.post('/admin/credits/add', {
      user_id: userId,
      amount,
      notes
    });
    return response.data;
  } catch (error) {
    console.error(`Error adding credits to user ${userId}:`, error);
    throw error;
  }
};

// Get credit transactions with pagination and filtering
export const getCreditTransactions = async (
  page = 1,
  perPage = 20,
  actionType = '',
  fromDate = null,
  toDate = null,
  userId = '',
  adminId = ''
) => {
  try {
    const params = { page, per_page: perPage };
    
    if (actionType) params.action_type = actionType;
    if (fromDate) params.from_date = fromDate.toISOString();
    if (toDate) params.to_date = toDate.toISOString();
    if (userId) params.user_id = userId;
    if (adminId) params.admin_id = adminId;
    
    const response = await api.get('/admin/credits/transactions', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching credit transactions:', error);
    throw error;
  }
};

// Get credit transactions for a specific user
export const getUserCreditTransactions = async (userId, page = 1, perPage = 20) => {
  try {
    const params = { page, per_page: perPage };
    
    const response = await api.get(`/admin/credits/transactions/${userId}`, { params });
    return response.data;
  } catch (error) {
    console.error(`Error fetching credit transactions for user ${userId}:`, error);
    throw error;
  }
};

// Get admin dashboard statistics
export const getAdminStats = async () => {
  try {
    const response = await api.get('/admin/stats');
    return response.data;
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    throw error;
  }
};

export default {
  generateLearningPath,
  getLearningPath,
  getHistoryPreview,
  getHistoryEntry,
  saveToHistory,
  updateHistoryEntry,
  deleteHistoryEntry,
  importLearningPath,
  clearHistory,
  exportHistory,
  getLocalHistoryRaw,
  clearLocalHistory,
  validateApiKeys,
  authenticateApiKeys,
  saveApiTokens,
  getSavedApiTokens,
  clearSavedApiTokens,
  register,
  login,
  refreshAuthToken,
  logout,
  migrateLearningPaths,
  getProgressUpdates,
  deleteLearningPath,
  checkAuthStatus,
  downloadLearningPathPDF,
  getUserCredits,
  // Admin API functions
  getUsers,
  getUser,
  updateUser,
  addCredits,
  getCreditTransactions,
  getUserCreditTransactions,
  getAdminStats,
};

