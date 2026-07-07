// 输入: nums = [1,2,3,4,5,6,7], k = 3
// 输出: [5,6,7,1,2,3,4]
// 解释:
// 向右轮转 1 步: [7,1,2,3,4,5,6]
// 向右轮转 2 步: [6,7,1,2,3,4,5]
// 向右轮转 3 步: [5,6,7,1,2,3,4]
/**
 Do not return anything, modify nums in-place instead.
 */
function rotate(nums: number[], k: number): void {
    const n = k % nums.length;
    const newNums = nums.slice(nums.length - n, nums.length).concat(nums.slice(0, nums.length - n));
    nums.splice(0, nums.length, ...newNums);
};

function rotate(nums: number[], k: number): void {
    const n = k % nums.length;
    let temp = 0;
    for (let i = 0, j = nums.length - 1; i < j; i++, j--) {
        temp = nums[j];
        nums[j] = nums[i];
        nums[i] = temp;
    }
    for (let i = 0, j = n - 1; i < j; i++, j--) {
        temp = nums[j];
        nums[j] = nums[i];
        nums[i] = temp;
    }
    for (let i = n, j = nums.length - 1; i < j; i++, j--) {
        temp = nums[j];
        nums[j] = nums[i];
        nums[i] = temp;
    }
};