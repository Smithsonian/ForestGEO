// LoginLogout.test.tsx
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom';
import {LoginLogout} from '@/components/loginlogout';
import {signIn, signOut, useSession} from "next-auth/react";

jest.mock("next-auth/react");

describe('LoginLogout Component', () => {
  it('displays login button when unauthenticated', () => {
    (useSession as jest.Mock).mockReturnValue({status: "unauthenticated"});
    render(<LoginLogout/>);
    expect(screen.getByRole('button')).toHaveTextContent('LoginRoundedIcon');
  });

  it('displays logout button and user info when authenticated', () => {
    (useSession as jest.Mock).mockReturnValue({
      status: "authenticated",
      data: {
        session: {
          user: {name: 'John Doe', email: 'johndoe@example.com', isAdmin: true, allsites: [], sites: []}
        }
      }
    });
    render(<LoginLogout/>);
    expect(screen.getByRole('button')).toHaveTextContent('LogoutRoundedIcon');
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('johndoe@example.com')).toBeInTheDocument();
  });

  it('calls signIn function on login button click', () => {
    (useSession as jest.Mock).mockReturnValue({status: "unauthenticated"});
    (signIn as jest.Mock).mockImplementation(() => Promise.resolve());
    render(<LoginLogout/>);
    const loginButton = screen.getByRole('button');
    fireEvent.click(loginButton);
    expect(signIn).toHaveBeenCalled();
  });

  it('calls signOut function on logout button click', () => {
    (useSession as jest.Mock).mockReturnValue({
      status: "authenticated",
      data: {user: {name: 'John Doe', email: 'johndoe@example.com'}}
    });
    (signOut as jest.Mock).mockImplementation(() => Promise.resolve());
    render(<LoginLogout/>);
    const logoutButton = screen.getByRole('button');
    fireEvent.click(logoutButton);
    expect(signOut).toHaveBeenCalled();
  });

  // You can add more tests to cover edge cases or specific functionalities.
});

