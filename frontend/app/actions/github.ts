'use server';

import { Octokit } from 'octokit';

/**
 * Server Action to create a GitHub issue securely.
 *
 * This keeps the GitHub PAT and repository details on the server,
 * never exposing them to the client bundle.
 *
 * @param title - Issue title
 * @param body - Issue body (markdown)
 * @param labels - Array of label names
 * @returns The created issue data
 */
export async function createGitHubIssue(title: string, body: string, labels?: string[]) {
  const pat = process.env.FG_PAT;
  const owner = process.env.OWNER;
  const repo = process.env.REPO;

  if (!pat || !owner || !repo) {
    throw new Error('GitHub configuration missing - check environment variables');
  }

  const octokit = new Octokit({ auth: pat });

  try {
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels: labels || []
    });

    return {
      success: true,
      issue: response.data
    };
  } catch (error: any) {
    console.error('Failed to create GitHub issue:', error);
    throw new Error(`Failed to create GitHub issue: ${error.message}`);
  }
}

/**
 * Server Action to get GitHub repository information.
 *
 * @returns Repository owner and name
 */
export async function getGitHubRepoInfo() {
  const owner = process.env.OWNER;
  const repo = process.env.REPO;

  if (!owner || !repo) {
    throw new Error('GitHub repository configuration missing');
  }

  return { owner, repo };
}
