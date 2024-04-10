"use client";
import React from 'react';
import Skeleton from '@mui/material/Skeleton';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';

function SidebarSkeleton() {
  return (
    <Box sx={{width: 'var(--Sidebar-width)', padding: 2, height: '100vh', overflow: 'auto'}}>
      {/* Header Placeholder */}
      <Skeleton variant="rectangular" height={60}/>

      <Divider/>

      {/* List Items Placeholder */}
      <List>
        {Array.from(new Array(5)).map((_, index) => (
          <ListItem key={index}>
            <Skeleton variant="text" height={40}/>
          </ListItem>
        ))}
      </List>

      <Divider/>

      {/* Modal Trigger Placeholder */}
      <Skeleton variant="rectangular" height={40}/>

      {/* Form Elements Placeholder */}
      <Box sx={{padding: 2}}>
        <Skeleton variant="text" height={30}/>
        <Skeleton variant="rectangular" height={56}/>
        <Skeleton variant="text" height={30}/>
        <Skeleton variant="rectangular" height={56}/>
        {/* Add more as needed based on the form elements in the Sidebar */}
      </Box>

      <Divider/>

      {/* Logout Button Placeholder */}
      <Skeleton variant="rectangular" height={40}/>
    </Box>
  );
}

export default SidebarSkeleton;
