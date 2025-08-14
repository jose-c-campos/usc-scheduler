import axios from 'axios';

// Use relative URLs - the Vite proxy will handle forwarding to the right server
const api = axios.create({
  baseURL: '',  // Use relative URLs to work with the Vite proxy
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;