// 给定一个大小为 n 的数组 nums ，返回其中的多数元素。多数元素是指在数组中出现次数 大于 ⌊ n/2 ⌋ 的元素。

// 你可以假设数组是非空的，并且给定的数组总是存在多数元素。

 

// 示例 1：

// 输入：nums = [3,2,3]
// 输出：3
// 示例 2：

// 输入：nums = [2,2,1,1,1,2,2]
// 输出：2
function majorityElement(nums: number[]): number {
    nums.sort((a, b) => a - b)
    return nums[Math.floor(nums.length / 2)]
};

// 方法二：哈希表
// 时间复杂度：O(n)
// 空间复杂度：O(n)
function majorityElement(nums: number[]): number {
    const map = new Map<number, number>()
    for (const num of nums) {
        map.set(num, (map.get(num) || 0) + 1)
    }
    for (const [num, count] of map) {
        if (count > nums.length / 2) {
            return num
        }
    }
};

// 方法三：摩尔投票法
// 时间复杂度：O(n)
// 空间复杂度：O(1)
function majorityElement(nums: number[]): number {
    let count = 0
    let candidate = 0
    for (const num of nums) {
        if (count === 0) {
            candidate = num
        }
        if (num === candidate) {
            count++
        } else {
            count--
        }
    }
    return candidate
};

// 递归
// 时间复杂度：O(nlogn)
// 空间复杂度：O(logn)
function majorityElement(nums: number[]): number {
    if (nums.length === 1) {
        return nums[0]
    }
    const mid = Math.floor(nums.length / 2)
    const left = nums.slice(0, mid)
    const right = nums.slice(mid)
    const leftMajority = majorityElement(left)
    const rightMajority = majorityElement(right)
    if (leftMajority === rightMajority) {
        return leftMajority
    }
    let leftCount = 0
    let rightCount = 0
    for (const num of nums) {
        if (num === leftMajority) {
            leftCount++
        }
        if (num === rightMajority) {
            rightCount++
        }
    }
    return leftCount > rightCount ? leftMajority : rightMajority
};
