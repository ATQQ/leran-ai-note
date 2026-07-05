// 给你一个有序数组 nums ，请你 原地 删除重复出现的元素，使得出现次数超过两次的元素只出现两次 ，返回删除后数组的新长度。

// 不要使用额外的数组空间，你必须在 原地 修改输入数组 并在使用 O(1) 额外空间的条件下完成。

// 1111
// 11
// 112223
// 11223
function removeDuplicates(nums: number[]): number {
    let n = 2
    if (nums.length < n + 1) {
        return nums.length
    }

    let k = 0
    let i = 1
    let count = 1
    while (i < nums.length) {
        if (nums[i] === nums[k]) {
            count++
        } else {
            count = 1
        }
        if (count <= n) {
            nums[++k] = nums[i]
        }
        i++
    }
    return k + 1
};

function removeDuplicates(nums: number[]): number {
    const length = nums.length
    if (length < 3) {
        return length
    }

    let k = 2
    let i = 2
    while (i < length) {
        if (nums[i] !== nums[k - 2]) {
            nums[k++] = nums[i]
        }
        i++
    }
    return k
};

function removeDuplicates(nums: number[]): number {
    let i = 0
    for (const num of nums) {
        if (i < 2 || num !== nums[i - 2]) {
            nums[i++] = num
        }
    }
    return i
};