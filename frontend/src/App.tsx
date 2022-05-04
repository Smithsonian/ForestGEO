import React from 'react';
import Button from '@mui/material/Button';
import Dropzone from './components/Dropzone';

function App() {
  return (
    <>
      <Dropzone />
      <Button variant="contained">Hello World</Button>
    </>
  );
}

export default App;
