import {
  useForumActionsContext,
  useForumDataContext,
} from '../context/ForumContext';

export const useForumData = () => {
  return useForumDataContext();
};

export const useForumActions = () => {
  return useForumActionsContext();
};
