import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGitHubIssue, getGitHubRepoInfo } from './github';
import { Octokit } from 'octokit';

// Mock Octokit
vi.mock('octokit');

describe('GitHub Server Actions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('createGitHubIssue', () => {
    it('should create a GitHub issue successfully', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      const mockIssueData = {
        id: 1,
        number: 123,
        title: 'Test Issue',
        body: 'Test body',
        state: 'open',
        html_url: 'https://github.com/test-owner/test-repo/issues/123'
      };

      const mockCreate = vi.fn().mockResolvedValue({
        data: mockIssueData
      });

      (Octokit as any).mockImplementation(() => ({
        rest: {
          issues: {
            create: mockCreate
          }
        }
      }));

      // Execute
      const result = await createGitHubIssue('Test Issue', 'Test body', ['bug', 'enhancement']);

      // Assert
      expect(result).toEqual({
        success: true,
        issue: mockIssueData
      });

      expect(mockCreate).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Test Issue',
        body: 'Test body',
        labels: ['bug', 'enhancement']
      });
    });

    it('should create an issue without labels when labels are not provided', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      const mockIssueData = {
        id: 2,
        number: 124,
        title: 'Test Issue Without Labels',
        body: 'Test body',
        state: 'open'
      };

      const mockCreate = vi.fn().mockResolvedValue({
        data: mockIssueData
      });

      (Octokit as any).mockImplementation(() => ({
        rest: {
          issues: {
            create: mockCreate
          }
        }
      }));

      // Execute
      const result = await createGitHubIssue('Test Issue Without Labels', 'Test body');

      // Assert
      expect(result).toEqual({
        success: true,
        issue: mockIssueData
      });

      expect(mockCreate).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Test Issue Without Labels',
        body: 'Test body',
        labels: []
      });
    });

    it('should throw an error when FG_PAT is missing', async () => {
      // Setup
      delete process.env.FG_PAT;
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      // Execute & Assert
      await expect(createGitHubIssue('Test', 'Body')).rejects.toThrow('GitHub configuration missing - check environment variables');
    });

    it('should throw an error when OWNER is missing', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      delete process.env.OWNER;
      process.env.REPO = 'test-repo';

      // Execute & Assert
      await expect(createGitHubIssue('Test', 'Body')).rejects.toThrow('GitHub configuration missing - check environment variables');
    });

    it('should throw an error when REPO is missing', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      delete process.env.REPO;

      // Execute & Assert
      await expect(createGitHubIssue('Test', 'Body')).rejects.toThrow('GitHub configuration missing - check environment variables');
    });

    it('should handle API errors gracefully', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      const mockCreate = vi.fn().mockRejectedValue(new Error('API rate limit exceeded'));

      (Octokit as any).mockImplementation(() => ({
        rest: {
          issues: {
            create: mockCreate
          }
        }
      }));

      // Execute & Assert
      await expect(createGitHubIssue('Test', 'Body')).rejects.toThrow('Failed to create GitHub issue: API rate limit exceeded');
    });

    it('should handle network errors', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      const mockCreate = vi.fn().mockRejectedValue(new Error('Network error'));

      (Octokit as any).mockImplementation(() => ({
        rest: {
          issues: {
            create: mockCreate
          }
        }
      }));

      // Execute & Assert
      await expect(createGitHubIssue('Test', 'Body')).rejects.toThrow('Failed to create GitHub issue: Network error');
    });

    it('should create an issue with empty labels array when undefined is passed', async () => {
      // Setup
      process.env.FG_PAT = 'test-pat-token';
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      const mockIssueData = {
        id: 3,
        number: 125,
        title: 'Test Issue',
        body: 'Test body'
      };

      const mockCreate = vi.fn().mockResolvedValue({
        data: mockIssueData
      });

      (Octokit as any).mockImplementation(() => ({
        rest: {
          issues: {
            create: mockCreate
          }
        }
      }));

      // Execute
      await createGitHubIssue('Test Issue', 'Test body', undefined);

      // Assert
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: []
        })
      );
    });
  });

  describe('getGitHubRepoInfo', () => {
    it('should return repository owner and name successfully', async () => {
      // Setup
      process.env.OWNER = 'test-owner';
      process.env.REPO = 'test-repo';

      // Execute
      const result = await getGitHubRepoInfo();

      // Assert
      expect(result).toEqual({
        owner: 'test-owner',
        repo: 'test-repo'
      });
    });

    it('should throw an error when OWNER is missing', async () => {
      // Setup
      delete process.env.OWNER;
      process.env.REPO = 'test-repo';

      // Execute & Assert
      await expect(getGitHubRepoInfo()).rejects.toThrow('GitHub repository configuration missing');
    });

    it('should throw an error when REPO is missing', async () => {
      // Setup
      process.env.OWNER = 'test-owner';
      delete process.env.REPO;

      // Execute & Assert
      await expect(getGitHubRepoInfo()).rejects.toThrow('GitHub repository configuration missing');
    });

    it('should throw an error when both OWNER and REPO are missing', async () => {
      // Setup
      delete process.env.OWNER;
      delete process.env.REPO;

      // Execute & Assert
      await expect(getGitHubRepoInfo()).rejects.toThrow('GitHub repository configuration missing');
    });

    it('should handle empty string environment variables as missing', async () => {
      // Setup
      process.env.OWNER = '';
      process.env.REPO = 'test-repo';

      // Execute & Assert
      await expect(getGitHubRepoInfo()).rejects.toThrow('GitHub repository configuration missing');
    });
  });
});
