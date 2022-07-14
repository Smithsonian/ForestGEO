import React from 'react';
import Dropzone from './components/Dropzone';
import Navbar from './components/Navbar';
import Validate from './components/Validate';
import Browse from './components/Browse';
import Report from './components/Report';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Validate />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </Router>
  );
}

export default App;
