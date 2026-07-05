// 输入：nums = [3,2,2,3], val = 3
// 输出：2, nums = [2,2,_,_]
// 解释：你的函数应该返回 k = 2, 并且 nums 中的前两个元素均为 2。
// 你在返回的 k 个元素之外留下了什么并不重要（因此它们并不计入评测）。

// 从前往后遍历
function removeElement(nums: number[], val: number): number {
    let i = 0;
    for (let j = 0; j < nums.length; j++) {
        if (nums[j] !== val) {
            nums[i++] = nums[j];
        }
    }
    return i;
};

// 从后往前遍历
function removeElement(nums: number[], val: number): number {
    let k = nums.length;
    let i = k - 1
    while(i>=0){
        if(nums[i]===val){
            [nums[i],nums[k-1]] = [nums[k-1],nums[i]]
            k--
        }
        i--
    }
    return k
};