// Mock utils for Cypress component tests

export const openSidebar = () => {
  // Mock implementation
  console.log('Mock: Opening sidebar');
};

export const closeSidebar = () => {
  // Mock implementation
  console.log('Mock: Closing sidebar');
};

export const toggleSidebar = () => {
  // Mock implementation
  console.log('Mock: Toggling sidebar');
};

// Mock other utility functions as needed
export const capitalizeFirstLetter = str => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const createError = (message, context) => {
  const error = new Error(message);
  error.name = 'ProcessingError';
  return error;
};

// Export other utilities that might be used
export default {
  openSidebar,
  closeSidebar,
  toggleSidebar,
  capitalizeFirstLetter,
  createError
};
