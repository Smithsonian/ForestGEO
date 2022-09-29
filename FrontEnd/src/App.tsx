import React, { useEffect, useState } from 'react';
import Validate from './pages/Validate';
import Browse from './components/Browse';
import Report from './pages/Report';
import Login from './components/Login';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import { Plot } from './components/SelectPlot';

function App() {
  const initialState: Plot = { plotName: '', plotNumber: 0 };
  const [localPlot, setLocalPlot] = useState(initialState);

  const [userInfo, setUserInfo] = useState<any>();

  useEffect(() => {
    (async () => {
      setUserInfo(await getUserInfo());
    })();
  }, []);

  async function getUserInfo() {
    try {
      const response = await fetch('/.auth/me');
      const payload = await response.json();
      const { clientPrincipal } = payload;
      return clientPrincipal;
    } catch (error) {
      console.error('No profile could be found');
      return undefined;
    }
  }
  return (
    <Router>
      {userInfo ? <Navbar /> : <p></p>}
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/validate"
          element={<Validate plot={localPlot} setPlot={setLocalPlot} />}
        />
        <Route
          path="/browse"
          element={<Browse plot={localPlot} setPlot={setLocalPlot} />}
        />
        <Route path="/report" element={<Report />} />
      </Routes>
    </Router>
  );
}

export default App;
