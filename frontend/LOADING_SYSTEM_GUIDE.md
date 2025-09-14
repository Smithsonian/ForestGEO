# ForestGEO Loading System Guide

## Overview

The ForestGEO application now includes a comprehensive loading state management system that **completely prevents user interaction during async operations**. This eliminates the issues with users clicking buttons multiple times or interacting with the UI while data is being processed.

## Key Features

- ✅ **Complete UI Blocking**: Users cannot interact with any part of the application during loading
- ✅ **Multiple Operation Support**: Handles multiple concurrent operations with unique tracking
- ✅ **Automatic Timeouts**: Operations timeout automatically (30s general, 5min uploads)
- ✅ **Visual Feedback**: Clear loading indicators with operation details and durations
- ✅ **Error Handling**: Automatic error handling with user feedback
- ✅ **Operation Deduplication**: Prevents duplicate operations from being started

## How to Use

### 1. For Simple Async Operations

Use the `useAsyncOperation` hook:

```typescript
import { useAsyncOperation } from '@/hooks/useAsyncOperation';

const { execute: myFunction } = useAsyncOperation(
  async (param1: string, param2: number) => {
    const response = await fetch(`/api/data/${param1}/${param2}`);
    return response.json();
  },
  {
    loadingMessage: 'Loading data...',
    category: 'api',
    onSuccess: result => console.log('Success!', result),
    onError: error => alert(`Failed: ${error.message}`)
  }
);

// Usage
const handleClick = () => {
  myFunction('example', 123);
};
```

### 2. For Form Submissions

Use the `useFormSubmission` hook:

```typescript
import { useFormSubmission } from '@/hooks/useAsyncOperation';

const { submitForm, isSubmitting } = useFormSubmission(
  async (formData: FormData) => {
    await fetch('/api/submit', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
  },
  {
    loadingMessage: 'Submitting form...',
    onSuccess: () => {
      alert('Form submitted successfully!');
      setFormData({}); // Reset form
    },
    onError: error => alert(`Submission failed: ${error.message}`)
  }
);

// Usage
const handleSubmit = () => {
  submitForm(currentFormData);
};
```

### 3. For API Calls

Use the `useApiWrapper` hook:

```typescript
import { useApiWrapper } from '@/utils/apiWrapper';

const MyComponent = () => {
  const ApiWrapper = useApiWrapper();

  const fetchData = async () => {
    const response = await ApiWrapper.get('/api/data', {
      loadingMessage: 'Fetching data...',
      category: 'api'
    });
    const data = await response.json();
    setData(data);
  };

  const saveData = async (data: any) => {
    await ApiWrapper.post('/api/save', data, {
      loadingMessage: 'Saving data...',
      category: 'processing'
    });
  };

  return (
    <Button onClick={fetchData}>Load Data</Button>
  );
};
```

### 4. For File Uploads

```typescript
const uploadFile = async (file: File) => {
  await ApiWrapper.uploadFile('/api/upload', file, {
    loadingMessage: 'Uploading file...',
    onProgress: progress => console.log(`Progress: ${progress}%`)
  });
};
```

## Migration Guide

### Replace Local Loading States

**Before:**

```typescript
const [loading, setLoading] = useState(false);

const myFunction = async () => {
  setLoading(true);
  try {
    await fetch('/api/data');
  } finally {
    setLoading(false);
  }
};
```

**After:**

```typescript
const { execute: myFunction } = useAsyncOperation(
  async () => {
    await fetch('/api/data');
  },
  { loadingMessage: 'Loading data...' }
);
```

### Replace Fetch Calls

**Before:**

```typescript
const response = await fetch('/api/data');
```

**After:**

```typescript
const ApiWrapper = useApiWrapper();
const response = await ApiWrapper.get('/api/data', {
  loadingMessage: 'Fetching data...'
});
```

## Operation Categories

- `'api'` - General API calls (30s timeout)
- `'upload'` - File uploads (5min timeout)
- `'processing'` - Data processing operations (30s timeout)
- `'general'` - Default category (30s timeout)

## Advanced Features

### Preventing Duplicate Operations

```typescript
const { execute } = useAsyncOperation(myFunction, {
  preventDuplicates: true // Default: true
});
```

### Custom Error Handling

```typescript
const { execute } = useAsyncOperation(myFunction, {
  onError: error => {
    // Custom error handling
    console.error('Operation failed:', error);
    showToast('Something went wrong');
  }
});
```

### Wrapping Existing Functions

```typescript
import { withLoadingState } from '@/utils/apiWrapper';

const wrappedFunction = withLoadingState(myExistingAsyncFunction, 'Processing...', 'processing');
```

## UI Behavior During Loading

When any operation is active:

- ✅ Complete page overlay prevents all interactions
- ✅ Loading spinner with operation details
- ✅ Duration tracking for long operations
- ✅ Multiple operation display when applicable
- ✅ Clear user messaging about waiting

The system is bulletproof - users **cannot** cause issues by clicking during loading operations.

## Best Practices

1. **Always use appropriate loading messages** that describe what's happening
2. **Choose correct categories** for proper timeout handling
3. **Handle errors gracefully** with user-friendly messages
4. **Don't create local loading states** - use the global system
5. **Test timeout scenarios** to ensure proper cleanup

## Troubleshooting

- **Loading doesn't show**: Ensure `useApiWrapper()` is called in the component
- **TypeScript errors**: Make sure you're using the correct hook imports
- **Operations don't end**: Check for unhandled errors in your async functions
- **Multiple operations**: The system handles this automatically - latest message is shown

The system is now production-ready and will eliminate all user interaction issues during async operations!
